import CashShift from '../models/CashShift.js';
import Sale from '../models/Sale.js';
import { z } from 'zod';
import cron from 'node-cron';

export const getCurrentShift = async (req, res) => {
    try {
        const shift = await CashShift.findOne({
            cashierId: req.user._id,
            status: 'OPEN'
        }).sort({ startTime: -1 });

        res.json(shift);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const startShift = async (req, res) => {
    try {
        const { openingBalance } = req.body;

        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        
        if (req.user.role !== 'admin' && (hours < 7 || (hours === 7 && minutes < 30))) {
            return res.status(403).json({ message: "Shifts cannot be opened before 7:30 AM." });
        }

        const existing = await CashShift.findOne({
            cashierId: req.user._id,
            status: 'OPEN'
        });

        if (existing) {
            return res.status(400).json({ message: "You already have an open shift." });
        }

        const shift = new CashShift({
            cashierId: req.user._id,
            openingBalance: openingBalance || 0,
            startTime: new Date(),
            status: 'OPEN'
        });

        await shift.save();
        res.status(201).json(shift);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

cron.schedule('0 0 * * *', async () => {
    try {
        const openShifts = await CashShift.find({ status: 'OPEN' });
        for (const shift of openShifts) {
            const sales = await Sale.find({
                cashierId: shift.cashierId,
                createdAt: { $gte: shift.startTime },
                paymentMethod: 'Cash',
                status: 'completed'
            });
            const cashSales = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);

            shift.endTime = new Date();
            shift.systemCalculatedSales = cashSales;
            shift.actualCashAmount = shift.openingBalance + cashSales;
            shift.closingBalance = shift.actualCashAmount;
            shift.discrepancy = 0;
            shift.status = 'CLOSED';
            shift.notes = 'Auto-closed at midnight by system.';

            await shift.save();
        }
    } catch (error) {
        console.error('Error in auto-closing shifts cron job:', error);
    }
});

export const endShift = async (req, res) => {
    try {
        const { closingBalance, notes } = req.body;

        const shift = await CashShift.findOne({
            cashierId: req.user._id,
            status: 'OPEN'
        });

        if (!shift) {
            return res.status(404).json({ message: "No open shift found." });
        }

        const sales = await Sale.find({
            cashierId: req.user._id,
            createdAt: { $gte: shift.startTime },
            paymentMethod: 'Cash',
            status: 'completed'
        });

        const cashSales = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);

        shift.endTime = new Date();
        shift.closingBalance = closingBalance;
        shift.systemCalculatedSales = cashSales;
        shift.actualCashAmount = closingBalance;

        const expected = shift.openingBalance + cashSales;
        shift.discrepancy = closingBalance - expected;

        shift.status = 'CLOSED';
        shift.notes = notes;

        await shift.save();
        res.json(shift);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getShiftHistory = async (req, res) => {
    try {
        const shifts = await CashShift.find({ cashierId: req.user._id })
            .sort({ startTime: -1 })
            .limit(20);
        res.json(shifts);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
