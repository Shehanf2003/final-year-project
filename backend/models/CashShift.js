import mongoose from 'mongoose';

const cashShiftSchema = new mongoose.Schema({
  cashierId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  startTime: {
    type: Date,
    required: true,
    default: Date.now
  },
  endTime: {
    type: Date
  },
  openingBalance: {
    type: Number,
    required: true,
    min: 0
  },
  closingBalance: {
    type: Number
  },
  systemCalculatedSales: {
    type: Number,
    default: 0
  },
  actualCashAmount: {
    type: Number
  },
  discrepancy: {
    type: Number
  },
  status: {
    type: String,
    enum: ['OPEN', 'CLOSED'],
    default: 'OPEN'
  },
  notes: String
}, {
  timestamps: true
});

const CashShift = mongoose.model('CashShift', cashShiftSchema);

export default CashShift;
