import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  contactPerson: String,
  email: {
    type: String,
    match: [/\S+@\S+\.\S+/, 'is invalid']
  },
  phone: String,
  address: String,
  taxId: String,
  paymentTerms: String
}, {
  timestamps: true
});

const Supplier = mongoose.model('Supplier', supplierSchema);

export default Supplier;
