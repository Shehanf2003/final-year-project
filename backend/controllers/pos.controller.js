import Sale from '../models/Sale.js';
import Customer from '../models/Customer.js';
import Prescription from '../models/Prescription.js';
import Batch from '../models/Batch.js';
import Product from '../models/Product.js';
import CashShift from '../models/CashShift.js';
import StockMovement from '../models/StockMovement.js';
import { sendBillNotification } from '../services/notification.service.js';
import { z } from 'zod';
import mongoose from 'mongoose';
import { getIO } from '../socket.js';

const saleItemSchema = z.object({
  productId: z.string(),
  batchId: z.string(),
  quantity: z.number().int().positive(),
  price: z.number().positive(),
  costPrice: z.number().min(0).optional(),
  discount: z.number().default(0),
  dosageInstructions: z.object({
      patientName: z.string().optional(),
      amount: z.string().optional(),
      unit: z.string().optional(),
      frequency: z.string().optional(),
      timing: z.string().optional()
  }).optional()
});

const saleSchema = z.object({
  items: z.array(saleItemSchema).min(1),
  paymentMethod: z.enum(['Cash', 'Card', 'Online']),
  customerId: z.string().optional(),
  prescriptionId: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactPhone: z.string().optional(),
  pointsToRedeem: z.number().int().min(0).optional().default(0),
});

const customerSchema = z.object({
  name: z.string().min(1),
  phoneNumber: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
});

const prescriptionSchema = z.object({
  patientName: z.string().min(1),
  doctorName: z.string().min(1),
  doctorRegNo: z.string().optional(),
  notes: z.string().optional(),
});

export const createSale = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (req.user && req.user.role !== 'admin') {
      const openShift = await CashShift.findOne({
        cashierId: req.user._id,
        status: 'OPEN'
      }).session(session);

      if (!openShift) {
        throw new Error("You must open a shift before creating a sale.");
      }
    }

    const validatedData = saleSchema.parse(req.body);

    if (validatedData.pointsToRedeem > 0) {
      if (!validatedData.customerId) {
        throw new Error("Cannot redeem points without a selected customer");
      }
      const customer = await Customer.findById(validatedData.customerId).session(session);
      if (!customer) throw new Error("Customer not found");

      if (customer.loyaltyPoints < validatedData.pointsToRedeem) {
        throw new Error(`Insufficient loyalty points. Available: ${customer.loyaltyPoints}`);
      }
    }

    let totalAmount = 0;
    const processedItems = [];

    for (const item of validatedData.items) {
      const batch = await Batch.findById(item.batchId).session(session);

      if (!batch) {
        throw new Error(`Batch not found for product ${item.productId}`);
      }

      if (batch.productId.toString() !== item.productId) {
        throw new Error(`Batch ${batch.batchNumber} does not belong to product ${item.productId}`);
      }

      if (batch.quantity < item.quantity) {
        throw new Error(`Insufficient stock for batch ${batch.batchNumber}. Available: ${batch.quantity}`);
      }

      if (item.price > batch.mrp) {
        throw new Error(`Price for batch ${batch.batchNumber} cannot exceed MRP (${batch.mrp})`);
      }

      totalAmount += (item.price * item.quantity) - item.discount;

      processedItems.push({
        ...item,
        costPrice: batch.costPrice || 0
      });

      if (batch.stockDistribution && batch.stockDistribution.length > 0) {
        let remainingQty = item.quantity;

        for (const stockEntry of batch.stockDistribution) {
          if (remainingQty <= 0) break;
          if (stockEntry.quantity > 0) {
            const deduct = Math.min(stockEntry.quantity, remainingQty);
            stockEntry.quantity -= deduct;
            remainingQty -= deduct;
          }
        }

        if (remainingQty > 0) {
           throw new Error(`Insufficient stock in distribution locations for batch ${batch.batchNumber}`);
        }
      } else {
        batch.quantity -= item.quantity;
      }

      await batch.save({ session });
    }

    // Apply loyalty points discount (Assuming 1 point = Rs. 1)
    if (validatedData.pointsToRedeem > 0) {
      if (validatedData.pointsToRedeem > totalAmount) {
        throw new Error("Cannot redeem points exceeding the total amount");
      }
      totalAmount -= validatedData.pointsToRedeem;
    }

    const sale = new Sale({
      receiptNumber: `RCPT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      items: processedItems,
      totalAmount,
      pointsRedeemed: validatedData.pointsToRedeem,
      paymentMethod: validatedData.paymentMethod,
      customerId: validatedData.customerId,
      prescriptionId: validatedData.prescriptionId,
      contactEmail: validatedData.contactEmail,
      contactPhone: validatedData.contactPhone,
      cashierId: req.user?._id
    });

    await sale.save({ session });

    let customerEmail = validatedData.contactEmail;
    let customerPhone = validatedData.contactPhone;

    if (validatedData.customerId) {
        const pointsEarned = Math.floor(totalAmount / 100);
        const netPointsChange = pointsEarned - (validatedData.pointsToRedeem || 0);
        const updatedCustomer = await Customer.findByIdAndUpdate(validatedData.customerId, {
            $inc: { loyaltyPoints: netPointsChange }
        }, { new: true, session });

        if (updatedCustomer) {
            if (!customerEmail && updatedCustomer.email) customerEmail = updatedCustomer.email;
            if (!customerPhone && updatedCustomer.phoneNumber) customerPhone = updatedCustomer.phoneNumber;
        }
    }

    await session.commitTransaction();
    session.endSession();

    if (customerEmail || customerPhone) {
        sendBillNotification({ email: customerEmail, phone: customerPhone }, sale).catch(err => {
            console.error("Failed to send bill notification:", err);
        });
    }

    const io = getIO();
    if (io) {
        console.log("Emitting live updates to frontends...");
        io.emit('DASHBOARD_UPDATE');
        io.emit('STATS_UPDATE');
        io.emit('FINANCE_UPDATE');
    }

    res.status(201).json(sale);

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.errors });
    }
    console.error("Sale creation failed:", error);
    res.status(400).json({ message: error.message });
  }
};

export const createCustomer = async (req, res) => {
  try {
    const validatedData = customerSchema.parse(req.body);
    const customer = new Customer(validatedData);
    await customer.save();
    res.status(201).json(customer);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.errors });
    }
    if (error.code === 11000) {
        return res.status(400).json({ message: "Phone number already exists" });
    }
    res.status(500).json({ message: error.message });
  }
};

export const getCustomers = async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};
    if (search) {
      query = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { phoneNumber: { $regex: search, $options: 'i' } }
        ]
      };
    }
    const customers = await Customer.find(query).sort({ createdAt: -1 }).limit(50);
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const addPrescription = async (req, res) => {
    try {
        const validatedData = prescriptionSchema.parse(req.body);

        const prescription = new Prescription(validatedData);
        await prescription.save();
        res.status(201).json(prescription);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: error.errors });
        }
        res.status(500).json({ message: error.message });
    }
};

const returnItemSchema = z.object({
    batchId: z.string(),
    quantity: z.number().int().positive()
});

const returnSchema = z.object({
    items: z.array(returnItemSchema).min(1)
});

export const processReturn = async (req, res) => {
    try {
        if (req.user && req.user.role !== 'admin') {
            const openShift = await CashShift.findOne({
                cashierId: req.user._id,
                status: 'OPEN'
            });

            if (!openShift) {
                return res.status(403).json({ message: "You must open a shift before processing a return." });
            }
        }

        const { id } = req.params;
        const validatedData = returnSchema.parse(req.body);

        const sale = await Sale.findById(id);
        if (!sale) return res.status(404).json({ message: "Sale not found" });

        if (sale.status === 'returned') {
            return res.status(400).json({ message: "Sale already fully returned" });
        }

        let refundTotal = 0;
        let pointsToDeduct = 0;
        let allReturned = true;

        for (const returnItem of validatedData.items) {
            const saleItem = sale.items.find(item => item.batchId.toString() === returnItem.batchId);

            if (!saleItem) {
                return res.status(400).json({ message: `Batch ${returnItem.batchId} not found in this sale` });
            }

            const currentReturned = saleItem.returnedQuantity || 0;
            const remainingQty = saleItem.quantity - currentReturned;

            if (returnItem.quantity > remainingQty) {
                return res.status(400).json({
                    message: `Cannot return ${returnItem.quantity}. Only ${remainingQty} remaining for this item.`
                });
            }

            saleItem.returnedQuantity = currentReturned + returnItem.quantity;

            const effectiveUnitPrice = ((saleItem.price * saleItem.quantity) - saleItem.discount) / saleItem.quantity;
            refundTotal += effectiveUnitPrice * returnItem.quantity;

            await Batch.findByIdAndUpdate(returnItem.batchId, {
                $inc: { quantity: returnItem.quantity }
            });

            await StockMovement.create({
                product: saleItem.productId,
                batch: saleItem.batchId,
                type: 'RETURN',
                quantity: returnItem.quantity,
                reason: `Return for Sale ${sale.receiptNumber}`,
                referenceId: sale._id,
                user: req.user?._id
            });
        }

        for (const item of sale.items) {
            if ((item.returnedQuantity || 0) < item.quantity) {
                allReturned = false;
                break;
            }
        }

        sale.refundedAmount = (sale.refundedAmount || 0) + refundTotal;
        if (allReturned) {
            sale.status = 'returned';
        }

        await sale.save();

        if (sale.customerId) {
            pointsToDeduct = Math.floor(refundTotal / 100);
            if (pointsToDeduct > 0) {
                await Customer.findByIdAndUpdate(sale.customerId, {
                    $inc: { loyaltyPoints: -pointsToDeduct }
                });
            }
        }

        const io = getIO();
        if (io) {
            io.emit('DASHBOARD_UPDATE');
            io.emit('STATS_UPDATE');
            io.emit('FINANCE_UPDATE');
        }

        res.json({ message: "Return processed successfully", sale, refundTotal });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: error.errors });
        }
        res.status(500).json({ message: error.message });
    }
};

export const getPosProducts = async (req, res) => {
    try {
        const products = await Product.find({ isDeleted: { $ne: true } }).lean();

        const posData = await Promise.all(products.map(async (product) => {
            const batches = await Batch.find({
                productId: product._id,
                quantity: { $gt: 0 },
                expiryDate: { $gt: new Date() }
            }).select('batchNumber expiryDate mrp costPrice quantity');

            if (batches.length === 0) return null;

            return {
                _id: product._id,
                name: product.name,
                genericName: product.genericName,
                category: product.category,
                barcode: product.barcode,
                batches: batches
            };
        }));

        res.json(posData.filter(p => p !== null));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getSalesHistory = async (req, res) => {
    try {
        const sales = await Sale.find()
            .populate('customerId', 'name')
            .populate('items.productId', 'name')
            .sort({ createdAt: -1 })
            .limit(100);
        res.json(sales);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getPublicSale = async (req, res) => {
    try {
        const { id } = req.params;
        const sale = await Sale.findById(id)
            .populate('items.productId', 'name genericName')
            .populate('customerId', 'name')
            .populate('cashierId', 'name');

        if (!sale) {
            return res.status(404).json({ message: "Sale not found" });
        }

        res.json(sale);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};