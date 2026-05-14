import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Batch from '../models/Batch.js';
import Location from '../models/Location.js';
import StockMovement from '../models/StockMovement.js';
import User from '../models/User.js';
import { sendLowStockAlert } from '../services/notification.service.js';
import { z } from 'zod';

const notifyIfLowStock = async (productId, locationId) => {
    try {
        const product = await Product.findById(productId);
        if (!product || product.minStockLevel === undefined) return;

        const totalQuantity = await Batch.checkLowStock(productId);

        if (totalQuantity <= product.minStockLevel) {
            const users = await User.find({
                $or: [
                    { role: 'admin' },
                    { allowedModules: 'INVENTORY' }
                ]
            });

            let locationName = "Unknown Location";
            if (locationId) {
                const loc = await Location.findById(locationId);
                if (loc) locationName = loc.name;
            }

            await sendLowStockAlert(users, product, locationName, totalQuantity);
        }
    } catch (error) {
        console.error("Error triggering low stock alert:", error);
    }
};

const initialBatchSchema = z.object({
  batchNumber: z.string().min(1, 'Batch number is required'),
  expiryDate: z.string().or(z.date()).transform((val) => new Date(val)),
  mrp: z.number().positive(),
  costPrice: z.number().min(0).optional(),
  supplierInvoiceId: z.string().optional(),
  quantity: z.number().int().nonnegative(),
}).refine((data) => data.expiryDate > new Date(), {
  message: "Expiry date must be in the future",
  path: ["expiryDate"],
});

const productSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  genericName: z.string().optional(),
  category: z.string().optional(),
  manufacturer: z.string().optional(),
  storageCondition: z.enum(['Cold Chain', 'Room Temp', 'Frozen', 'Refrigerated']).optional(),
  minStockLevel: z.coerce.number().min(0).optional(),
  barcode: z.string().optional(),
  taxRate: z.coerce.number().min(0).optional(),
  initialBatch: initialBatchSchema.optional(),
});

const batchSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  batchNumber: z.string().min(1, 'Batch number is required'),
  expiryDate: z.string().or(z.date()).transform((val) => new Date(val)),
  mrp: z.number().positive(),
  costPrice: z.number().min(0).optional(),
  quantity: z.number().int().nonnegative(),
  supplierInvoiceId: z.string().optional(),
}).refine((data) => data.expiryDate > new Date(), {
  message: "Expiry date must be in the future",
  path: ["expiryDate"],
});

export const addProduct = async (req, res) => {
  let savedProduct = null;
  try {
    const validatedData = productSchema.parse(req.body);

    const { initialBatch, ...productData } = validatedData;

    const product = new Product(productData);
    savedProduct = await product.save();

    if (initialBatch) {
      try {
        const warehouse = await Location.findOne({ type: 'Warehouse' }) || await Location.findOne({});
        const batch = new Batch({
          ...initialBatch,
          productId: savedProduct._id,
          stockDistribution: warehouse ? [{ location: warehouse._id, quantity: initialBatch.quantity }] : []
        });
        await batch.save();

        if (warehouse) {
             await StockMovement.create({
                product: savedProduct._id,
                batch: batch._id,
                type: 'INITIAL',
                quantity: initialBatch.quantity,
                toLocation: warehouse._id,
                reason: 'Initial Product Creation',
                user: req.user?._id
             });
        }

      } catch (batchError) {
        await Product.findByIdAndDelete(savedProduct._id);

        if (batchError.code === 11000) {
           return res.status(400).json({ message: "Batch number must be unique" });
        }
        throw batchError; // Re-throw to be caught by the outer catch block
      }
    }

    res.status(201).json(savedProduct);
  } catch (error) {
    if (error instanceof z.ZodError) {
       if (Array.isArray(error.errors)) {
          const nmraErrors = error.errors.filter(e =>
              e.message === "Expiry date must be in the future"
          );
          if (nmraErrors.length > 0) {
              return res.status(400).json({ message: "NMRA Compliance Violation: " + nmraErrors.map(e => e.message).join(", ") });
          }
          return res.status(400).json({ errors: error.errors });
       }
    }
    res.status(500).json({ message: error.message });
  }
};

export const addBatch = async (req, res) => {
  try {
    const { batchNumber, expiryDate, mrp } = req.body;
    if (!batchNumber || !expiryDate || mrp === undefined) {
       return res.status(400).json({ message: "NMRA Compliance Violation: Missing Batch Data" });
    }

    const validatedData = batchSchema.parse(req.body);

    const product = await Product.findById(validatedData.productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const warehouse = await Location.findOne({ type: 'Warehouse' }) || await Location.findOne({});

    const batch = new Batch({
        ...validatedData,
        stockDistribution: warehouse ? [{ location: warehouse._id, quantity: validatedData.quantity }] : []
    });

    await batch.save();

    if (warehouse) {
        await StockMovement.create({
           product: product._id,
           batch: batch._id,
           type: 'INITIAL',
           quantity: validatedData.quantity,
           toLocation: warehouse._id,
           reason: 'Manual Batch Add',
           user: req.user?._id
        });
   }

    res.status(201).json(batch);
  } catch (error) {
    if (error instanceof z.ZodError) {
        const nmraErrors = error.errors.filter(e =>
            e.message === "Expiry date must be in the future"
        );
        if (nmraErrors.length > 0) {
             return res.status(400).json({ message: "NMRA Compliance Violation: " + nmraErrors.map(e => e.message).join(", ") });
        }
        return res.status(400).json({ errors: error.errors });
    }
    if (error.code === 11000) {
         return res.status(400).json({ message: "Batch number must be unique" });
    }
    res.status(500).json({ message: error.message });
  }
};

const updateProductSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  genericName: z.string().optional(),
  category: z.string().optional(),
  manufacturer: z.string().optional(),
  storageCondition: z.enum(['Cold Chain', 'Room Temp', 'Frozen', 'Refrigerated']).optional(),
  minStockLevel: z.coerce.number().min(0).optional(),
  barcode: z.string().optional(),
  taxRate: z.coerce.number().min(0).optional(),
});

export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const validatedData = updateProductSchema.parse(req.body);
    
    const product = await Product.findByIdAndUpdate(id, validatedData, { new: true });
    if (!product) return res.status(404).json({ message: "Product not found" });
    
    res.json(product);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
    res.status(500).json({ message: error.message });
  }
};

export const getLowStockAlerts = async (req, res) => {
  try {
    const products = await Product.find({ isDeleted: { $ne: true } }).populate('batches');
    const lowStockProducts = [];

    for (const product of products) {
      const totalQuantity = await Batch.checkLowStock(product._id);
      if (totalQuantity < product.minStockLevel) {
        lowStockProducts.push({
          ...product.toObject(),
          totalQuantity
        });
      }
    }

    res.json(lowStockProducts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getExpiringBatches = async (req, res) => {
  try {
    const ninetyDaysFromNow = new Date();
    ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

    const batches = await Batch.find({
      expiryDate: {
        $gte: new Date(),
        $lte: ninetyDaysFromNow
      }
    }).populate({
        path: 'productId',
        select: 'name genericName',
        match: { isDeleted: { $ne: true } }
    });

    const activeBatches = batches.filter(batch => batch.productId !== null);

    res.json(activeBatches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getInventory = async (req, res) => {
    try {
        const products = await Product.find({ isDeleted: { $ne: true } }).lean();
        const inventory = await Promise.all(products.map(async (product) => {
            const totalQuantity = await Batch.checkLowStock(product._id);
            const batches = await Batch.find({ productId: product._id }).sort({ expiryDate: 1 }).limit(1);
            const nextExpiryDate = batches.length > 0 ? batches[0].expiryDate : null;
            const mrp = batches.length > 0 ? batches[0].mrp : 0;
            const costPrice = batches.length > 0 ? batches[0].costPrice : 0;

            return {
                ...product,
                totalStock: totalQuantity,
                nextExpiryDate: nextExpiryDate,
                mrp: mrp,
                costPrice: costPrice
            };
        }));
        res.json(inventory);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

const deleteProductSchema = z.object({
    reason: z.string().min(1, "Reason is required for deletion")
});

export const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = deleteProductSchema.parse(req.body);

        const product = await Product.findById(id);
        if (!product) return res.status(404).json({ message: "Product not found" });

        product.isDeleted = true;
        product.deletionReason = reason;
        product.deletedBy = req.user?._id;
        product.deletedAt = new Date();
        await product.save();

        res.json({ message: "Product deleted successfully" });
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0].message });
        res.status(500).json({ message: error.message });
    }
};

export const getAllBatches = async (req, res) => {
  try {
    const batches = await Batch.find()
      .populate({
        path: 'productId',
        select: 'name genericName barcode',
        match: { isDeleted: { $ne: true } }
      })
      .populate('stockDistribution.location', 'name')
      .sort({ expiryDate: 1 });

    const activeBatches = batches.filter(batch => batch.productId !== null);

    res.json(activeBatches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, mrp, costPrice } = req.body;

    if (quantity === undefined && mrp === undefined && costPrice === undefined) {
        return res.status(400).json({ message: "Valid quantity, mrp, or costPrice is required" });
    }

    const batch = await Batch.findById(id);
    if (!batch) return res.status(404).json({ message: "Batch not found" });

    if (typeof mrp === 'number') {
        if (mrp < 0) return res.status(400).json({ message: "Valid mrp is required" });
        batch.mrp = mrp;
    }

    if (typeof costPrice === 'number') {
        if (costPrice < 0) return res.status(400).json({ message: "Valid costPrice is required" });
        batch.costPrice = costPrice;
    }

    let locationId = null;
    if (quantity !== undefined) {
        if (quantity < 0) return res.status(400).json({ message: "Valid quantity is required" });
        if (batch.stockDistribution.length > 0) {
            const diff = quantity - batch.stockDistribution[0].quantity;
            batch.stockDistribution[0].quantity = quantity;
            locationId = batch.stockDistribution[0].location;

            if (diff !== 0) {
                await StockMovement.create({
                    product: batch.productId,
                    batch: batch._id,
                    type: 'ADJUSTMENT',
                    quantity: Math.abs(diff),
                    toLocation: batch.stockDistribution[0].location,
                    reason: 'Manual Quantity Override',
                    user: req.user?._id
                });
            }

        } else {
             const warehouse = await Location.findOne({ type: 'Warehouse' }) || await Location.findOne({});
             if (warehouse) {
                 batch.stockDistribution.push({ location: warehouse._id, quantity });
                 locationId = warehouse._id;

                  await StockMovement.create({
                    product: batch.productId,
                    batch: batch._id,
                    type: 'ADJUSTMENT',
                    quantity: quantity,
                    toLocation: warehouse._id,
                    reason: 'Manual Quantity Override (New Loc)',
                    user: req.user?._id
                });
             }
        }
    }

    await batch.save();

    if (locationId && quantity !== undefined) {
        await notifyIfLowStock(batch.productId, locationId);
    }

    res.json(batch);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const batch = await Batch.findByIdAndDelete(id);

    if (!batch) {
        return res.status(404).json({ message: "Batch not found" });
    }

    await notifyIfLowStock(batch.productId, null);

    res.json({ message: "Batch deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateProductPrice = async (req, res) => {
  try {
    const { id } = req.params;
    const { mrp, costPrice } = req.body;

    const updateFields = {};
    if (typeof mrp === 'number' && mrp >= 0) updateFields.mrp = mrp;
    if (typeof costPrice === 'number' && costPrice >= 0) updateFields.costPrice = costPrice;

    if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({ message: "Valid mrp or costPrice is required" });
    }

    await Batch.updateMany({ productId: id }, { $set: updateFields });

    res.json({ message: "Product prices updated successfully across all batches" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const transferSchema = z.object({
    batchId: z.string(),
    fromLocationId: z.string(),
    toLocationId: z.string(),
    quantity: z.number().positive(),
    reason: z.string().optional()
});

export const transferStock = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { batchId, fromLocationId, toLocationId, quantity, reason } = transferSchema.parse(req.body);

        const batch = await Batch.findById(batchId).session(session);
        if (!batch) {
            await session.abortTransaction();
            return res.status(404).json({ message: "Batch not found" });
        }

        const sourceStock = batch.stockDistribution.find(s => s.location.toString() === fromLocationId);
        if (!sourceStock || sourceStock.quantity < quantity) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Insufficient stock at source location" });
        }

        sourceStock.quantity -= quantity;

        const destStock = batch.stockDistribution.find(s => s.location.toString() === toLocationId);
        if (destStock) {
            destStock.quantity += quantity;
        } else {
            batch.stockDistribution.push({ location: toLocationId, quantity });
        }

        await batch.save({ session });

        // Note: Mongoose Model.create() requires the documents to be passed in an array when using a session
        await StockMovement.create([{
            product: batch.productId,
            batch: batch._id,
            type: 'TRANSFER',
            quantity,
            fromLocation: fromLocationId,
            toLocation: toLocationId,
            reason,
            user: req.user?._id
        }], { session });

        await session.commitTransaction();
        res.json({ message: "Transfer successful", batch });

    } catch (error) {
        await session.abortTransaction();
        if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
        res.status(500).json({ message: error.message });
    } finally {
        session.endSession();
    }
};

const adjustSchema = z.object({
    batchId: z.string(),
    locationId: z.string(),
    quantity: z.number().nonnegative(),
    reason: z.string().min(1, 'Reason is required')
});

export const adjustStock = async (req, res) => {
    try {
        const { batchId, locationId, quantity, reason } = adjustSchema.parse(req.body);

        const batch = await Batch.findById(batchId);
        if (!batch) return res.status(404).json({ message: "Batch not found" });

        const stockEntry = batch.stockDistribution.find(s => s.location.toString() === locationId);

        const currentQty = stockEntry ? stockEntry.quantity : 0;
        const diff = quantity - currentQty;

        if (diff === 0) return res.json({ message: "No change", batch });

        if (stockEntry) {
            stockEntry.quantity = quantity;
        } else {
            batch.stockDistribution.push({ location: locationId, quantity });
        }

        await batch.save();

        await StockMovement.create({
            product: batch.productId,
            batch: batch._id,
            type: 'ADJUSTMENT',
            quantity: Math.abs(diff),
            flow: diff > 0 ? 'IN' : 'OUT',
            toLocation: locationId,
            reason: `Manual Adjustment: ${reason}`,
            user: req.user?._id
        });

        await notifyIfLowStock(batch.productId, locationId);

        res.json({ message: "Adjustment successful", batch });

    } catch (error) {
         if (error instanceof z.ZodError) return res.status(400).json({ errors: error.errors });
        res.status(500).json({ message: error.message });
    }
};

export const getLocations = async (req, res) => {
    try {
        const count = await Location.countDocuments();
        if (count === 0) {
            await Location.create([
                { name: 'Main Warehouse', type: 'Warehouse' },
                { name: 'Pharmacy Store', type: 'Store' }
            ]);
        }

        const locations = await Location.find();
        res.json(locations);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

export const getHistoricalValuation = async (req, res) => {
  try {
    const { endDate } = req.query;
    
    const targetDate = endDate ? new Date(endDate) : new Date();

    const historicalStock = await StockMovement.aggregate([
      { $match: { createdAt: { $lte: targetDate } } },
      
      { 
        $group: {
          _id: "$batch",
          netQuantity: {
            $sum: {
              $cond: [ { $eq: ["$flow", "IN"] }, "$quantity", { $multiply: ["$quantity", -1] } ]
            }
          }
        }
      },
      
      {
        $lookup: {
          from: "batches",
          localField: "_id",
          foreignField: "_id",
          as: "batchDetails"
        }
      },
      { $unwind: "$batchDetails" }
    ]);

    const valuation = historicalStock.reduce((acc, item) => {
      const validQty = Math.max(0, item.netQuantity); 
      
      acc.totalCost += (item.batchDetails.costPrice || 0) * validQty;
      acc.totalMrp += (item.batchDetails.mrp || 0) * validQty;
      return acc;
    }, { totalCost: 0, totalMrp: 0 });

    res.json(valuation);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};