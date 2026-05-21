
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Loader2, Printer } from 'lucide-react';

const BillView = () => {
  const { id } = useParams();
  const [sale, setSale] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchSale = async () => {
      try {
        const res = await axios.get(`/api/pos/sales/public/${id}`);
        setSale(res.data);
      } catch (err) {
        setError("Failed to load bill. It may not exist or the link is invalid.");
      } finally {
        setLoading(false);
      }
    };
    fetchSale();
  }, [id]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-600" size={48} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center p-4">
        <div className="text-center text-red-600 bg-red-50 p-8 rounded-lg shadow">
          <h2 className="text-2xl font-bold mb-2">Error</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-10 px-4 print:bg-white print:p-0">
      <div className="max-w-2xl mx-auto mb-4 flex justify-end print:hidden">
        <button
          onClick={() => window.print()}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow hover:bg-blue-700 flex items-center gap-2 transition-colors font-medium"
        >
          <Printer size={18} /> Print Receipt
        </button>
      </div>
      <div className="max-w-2xl mx-auto bg-white shadow-xl rounded-lg overflow-hidden print:shadow-none print:w-full print:max-w-full">
        <div className="bg-blue-600 text-white p-6 text-center print:bg-white print:text-black print:border-b print:border-gray-200 print:px-0 print:py-4">
          <h1 className="text-3xl font-bold">Pharma ERP</h1>
          <p className="opacity-90 print:opacity-100 print:text-gray-600">Official Receipt</p>
        </div>

        <div className="p-6 border-b flex flex-col md:flex-row justify-between gap-4 print:px-0 print:py-4 print:flex-row">
          <div>
            <p className="text-sm text-gray-500">Receipt Number</p>
            <p className="font-mono font-bold">{sale.receiptNumber}</p>
          </div>
          <div className="md:text-right">
            <p className="text-sm text-gray-500">Date</p>
            <p className="font-medium">{new Date(sale.createdAt).toLocaleString()}</p>
          </div>
        </div>

        {(sale.customerId || sale.contactEmail || sale.contactPhone) && (
            <div className="p-6 border-b bg-gray-50 print:bg-white print:px-0 print:py-4">
                <p className="text-sm text-gray-500 mb-1">Billed To:</p>
                {sale.customerId && <p className="font-bold">{sale.customerId.name}</p>}
                {sale.contactEmail && <p className="text-sm">{sale.contactEmail}</p>}
                {sale.contactPhone && <p className="text-sm">{sale.contactPhone}</p>}
            </div>
        )}

        <div className="p-6 print:px-0 print:py-4">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b text-sm text-gray-500">
                <th className="pb-2">Item</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2 text-right">Price</th>
                <th className="pb-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sale.items.map((item, index) => (
                <tr key={index}>
                  <td className="py-3">
                    <div className="font-medium">{item.productId?.name || 'Unknown Product'}</div>
                    <div className="text-xs text-gray-400">{item.productId?.genericName}</div>
                  </td>
                  <td className="py-3 text-right">{item.quantity}</td>
                  <td className="py-3 text-right">Rs. {item.price.toFixed(2)}</td>
                  <td className="py-3 text-right font-bold">
                    Rs. {((item.price * item.quantity) - item.discount).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-6 bg-gray-50 border-t print:bg-white print:px-0 print:py-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-600">Payment Method</span>
            <span className="font-medium">{sale.paymentMethod}</span>
          </div>
          {sale.pointsRedeemed > 0 && (
            <>
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-600">Subtotal</span>
                <span className="font-medium">Rs. {(sale.totalAmount + sale.pointsRedeemed).toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-600">Points Redeemed</span>
                <span className="font-medium text-emerald-600">- Rs. {sale.pointsRedeemed.toFixed(2)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between items-center text-xl font-bold border-t border-gray-200 pt-4 mt-2">
            <span>Total Amount</span>
            <span>Rs. {sale.totalAmount.toFixed(2)}</span>
          </div>
        </div>

        <div className="p-4 text-center text-xs text-gray-400 print:text-gray-600 print:mt-4">
            Thank you for your business!
        </div>
      </div>
    </div>
  );
};

export default BillView;
