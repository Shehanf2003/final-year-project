import OptimizationAction from '../models/OptimizationAction.js';
import { z } from 'zod';

const actionSchema = z.object({
  action_id: z.string().min(1, 'Action ID is required'),
  name: z.string().min(1, 'Name is required'),
  savings_expense_multiplier: z.number().min(0).max(1).default(0.0),
  savings_utility_multiplier: z.number().min(0).max(1).default(0.0),
  fallback_expense_multiplier: z.number().min(0).max(1).default(0.0),
  disruption: z.number().min(1).max(10),
  isActive: z.boolean().default(true)
});

export const addAction = async (req, res) => {
  try {
    const validatedData = actionSchema.parse(req.body);
    
    const existingAction = await OptimizationAction.findOne({ action_id: validatedData.action_id });
    if (existingAction) {
        return res.status(400).json({ message: "An action with this ID already exists" });
    }

    const newAction = new OptimizationAction(validatedData);
    await newAction.save();

    res.status(201).json({ message: "Optimization action added successfully", data: newAction });
  } catch (error) {
    if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: error.errors });
    }
    res.status(500).json({ message: error.message });
  }
};

export const getActions = async (req, res) => {
  try {
    const actions = await OptimizationAction.find();
    res.json(actions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};