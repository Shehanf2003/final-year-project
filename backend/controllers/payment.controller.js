export const initiatePayment = async (req, res) => {
    try {
        const { amount, orderId, provider } = req.body;

        const transactionId = `TXN-${Date.now()}`;

        res.json({
            status: 'INITIATED',
            transactionId,
            redirectUrl: null,
            qrCodeData: `mock-payment://${provider}?amount=${amount}&ref=${transactionId}`
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const verifyPayment = async (req, res) => {
    try {
        const { transactionId } = req.body;

        res.json({
            status: 'SUCCESS',
            transactionId,
            message: 'Payment verified successfully'
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
