import mongoose from 'mongoose';

const nmraPriceCapSchema = new mongoose.Schema({
  genericName: { type: String, required: true, unique: true, lowercase: true },
  maxPrice: { type: Number, required: true }
}, { timestamps: true });

export default mongoose.model('NmraPriceCap', nmraPriceCapSchema);