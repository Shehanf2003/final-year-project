import mongoose from 'mongoose';

const optimizationActionSchema = new mongoose.Schema({
  action_id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  savings_expense_multiplier: { type: Number, default: 0.0 },
  savings_utility_multiplier: { type: Number, default: 0.0 },
  fallback_expense_multiplier: { type: Number, default: 0.0 },
  disruption: { type: Number, required: true, min: 1, max: 10 },
  isActive: { type: Boolean, default: true }
}, { 
  timestamps: true,
  // Explicitly name the collection so the Python backend finds it
  collection: 'optimization_actions' 
});

export default mongoose.model('OptimizationAction', optimizationActionSchema);