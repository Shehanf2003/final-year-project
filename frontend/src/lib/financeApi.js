import axiosInstance from './axios';

export const getFinancialStats = async (startDate, endDate) => {
  try {
    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    const response = await axiosInstance.get('/finance/stats', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching financial stats:', error);
    throw error;
  }
};

export const getFinancialReport = async (type, startDate, endDate) => {
  try {
    const response = await axiosInstance.get('/finance/reports', {
      params: { type, startDate, endDate }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching financial report:', error);
    throw error;
  }
};

export const getExpenses = async () => {
  try {
    const response = await axiosInstance.get('/finance/expenses');
    return response.data;
  } catch (error) {
    console.error('Error fetching expenses:', error);
    throw error;
  }
};

export const addExpense = async (data) => {
  try {
    const response = await axiosInstance.post('/finance/expenses', data);
    return response.data;
  } catch (error) {
    console.error('Error adding expense:', error);
    throw error;
  }
};

export const getPayables = async () => {
  try {
    const response = await axiosInstance.get('/inventory/payables');
    return response.data;
  } catch (error) {
    console.error('Error fetching payables:', error);
    throw error;
  }
};

export const recordPayment = async (data) => {
  try {
    const response = await axiosInstance.post('/inventory/payments', data);
    return response.data;
  } catch (error) {
    console.error('Error recording payment:', error);
    throw error;
  }
};

export const getSupplierPayments = async (supplierId) => {
  try {
    const params = {};
    if (supplierId) params.supplierId = supplierId;
    const response = await axiosInstance.get('/inventory/payments', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching supplier payments:', error);
    throw error;
  }
};

export const getCurrentShift = async () => {
  try {
    const response = await axiosInstance.get('/shifts/current');
    return response.data;
  } catch (error) {
    console.error('Error fetching current shift:', error);
    throw error;
  }
};

export const startShift = async (openingBalance) => {
  try {
    const response = await axiosInstance.post('/shifts/start', { openingBalance });
    return response.data;
  } catch (error) {
    console.error('Error starting shift:', error);
    throw error;
  }
};

export const endShift = async (data) => {
  try {
    const response = await axiosInstance.post('/shifts/end', data);
    return response.data;
  } catch (error) {
    console.error('Error ending shift:', error);
    throw error;
  }
};

export const initiatePayment = async (data) => {
  try {
    const response = await axiosInstance.post('/payments/initiate', data);
    return response.data;
  } catch (error) {
    console.error('Error initiating payment:', error);
    throw error;
  }
};
