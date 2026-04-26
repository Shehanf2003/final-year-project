import Sale from '../models/Sale.js';
import mongoose from 'mongoose';

export const getSalesDashboard = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const matchStage = { status: 'completed' };
        
        if (startDate && endDate) {
            matchStage.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)) 
            };
        }

        const basicMetricsResult = await Sale.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: { $subtract: ["$totalAmount", "$refundedAmount"] } },
                    totalOrders: { $sum: 1 }
                }
            }
        ]);

        const totalRevenue = basicMetricsResult.length > 0 ? basicMetricsResult[0].totalRevenue : 0;
        const totalOrders = basicMetricsResult.length > 0 ? basicMetricsResult[0].totalOrders : 0;
        const avgOrderValue = totalOrders > 0 ? (totalRevenue / totalOrders) : 0;

        const salesTrendsRaw = await Sale.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
                    Revenue: { $sum: { $subtract: ["$totalAmount", "$refundedAmount"] } }
                }
            },
            { $sort: { "_id": 1 } }
        ]);

        const salesTrends = salesTrendsRaw.map(item => ({
            date: item._id,
            Revenue: item.Revenue
        }));

        const categoryDataRaw = await Sale.aggregate([
            { $match: matchStage },
            { $unwind: "$items" },
            {
                $lookup: {
                    from: "products",
                    localField: "items.productId",
                    foreignField: "_id",
                    as: "product"
                }
            },
            { $unwind: "$product" },
            {
                $group: {
                    _id: "$product.category",
                    sales: {
                        $sum: {
                            $multiply: [
                                { $subtract: ["$items.quantity", "$items.returnedQuantity"] },
                                "$items.price"
                            ]
                        }
                    }
                }
            },
            { $sort: { sales: -1 } }
        ]);

        const categoryData = categoryDataRaw.map(item => ({
            name: item._id || "Uncategorized",
            sales: item.sales
        }));

        const topProductsRaw = await Sale.aggregate([
            { $match: matchStage },
            { $unwind: "$items" },
            {
                $lookup: {
                    from: "products",
                    localField: "items.productId",
                    foreignField: "_id",
                    as: "product"
                }
            },
            { $unwind: "$product" },
            {
                $group: {
                    _id: "$product.name",
                    units: { $sum: { $subtract: ["$items.quantity", "$items.returnedQuantity"] } }
                }
            },
            { $sort: { units: -1 } },
            { $limit: 5 }
        ]);

        const topProducts = topProductsRaw.map(item => ({
            name: item._id || "Unknown Product",
            units: item.units
        }));

        const dashboardData = {
            salesTrends,
            categoryData,
            topProducts,
            totalRevenue,
            totalOrders,
            avgOrderValue
        };

        res.json(dashboardData);

    } catch (error) {
        console.error("Dashboard Aggregation Error:", error);
        res.status(500).json({ message: "Failed to generate sales analytics" });
    }
};