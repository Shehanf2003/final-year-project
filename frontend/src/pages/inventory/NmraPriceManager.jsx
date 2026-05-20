import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';

const NmraPriceManager = () => {
  const [prices, setPrices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ genericName: '', maxPrice: '' });

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  };

  const CACHE_KEY = 'nmraPricesCache';
  const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  const fetchPrices = async () => {
    try {
      setLoading(true);
      
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Date.now() - parsed.timestamp < CACHE_DURATION) {
            setPrices(parsed.data);
            return;
          }
        } catch (e) {
          console.warn("Invalid NMRA cache, fetching fresh data...");
        }
      }

      const res = await fetch('/api/inventory/nmra-prices', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
        setPrices(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrices();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/inventory/nmra-prices', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          genericName: formData.genericName,
          maxPrice: Number(formData.maxPrice)
        })
      });
      
      if (res.ok) {
        localStorage.removeItem(CACHE_KEY); // Invalidate cache on change
        setShowAddForm(false);
        setFormData({ genericName: '', maxPrice: '' });
        fetchPrices();
      } else {
        const data = await res.json();
        alert(data.message || 'Failed to save NMRA price');
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (priceCapId) => {
    if (!window.confirm("Are you sure you want to delete this price cap?")) {
      return;
    }

    try {
      const res = await fetch(`/api/inventory/nmra-prices/${priceCapId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      if (res.ok) {
        localStorage.removeItem(CACHE_KEY); // Invalidate cache
        fetchPrices(); // Refetch
      } else {
        const data = await res.json();
        alert(data.message || 'Failed to delete NMRA price');
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const handleEdit = (priceCap) => {
    setFormData({ genericName: priceCap.genericName, maxPrice: priceCap.maxPrice });
    setShowAddForm(true);
  };

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-medium text-gray-900">NMRA Price Caps</h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add / Update Cap
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleSubmit} className="mb-8 p-4 bg-gray-50 rounded-lg border border-gray-200 flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
              <label className="block text-sm font-medium text-gray-700 mb-1">Generic Name *</label>
              <input
                placeholder="e.g. Paracetamol" required
                value={formData.genericName}
                onChange={e => setFormData({...formData, genericName: e.target.value})}
                className="w-full p-2 border rounded shadow-sm"
              />
          </div>
          <div className="flex-1 w-full">
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Price (Rs.) *</label>
              <input
                type="number" step="0.01" min="0" required
                placeholder="e.g. 4.00"
                value={formData.maxPrice}
                onChange={e => setFormData({...formData, maxPrice: e.target.value})}
                className="w-full p-2 border rounded shadow-sm"
              />
          </div>
          <div className="flex space-x-2 w-full md:w-auto">
              <button type="button" onClick={() => { setShowAddForm(false); setFormData({ genericName: '', maxPrice: '' }); }} className="px-4 py-2 border rounded text-gray-600 bg-white">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded">Save</button>
          </div>
        </form>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Generic Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Max Price (Rs.)</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {prices.map((p) => (
                <tr key={p._id}>
                  <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900 capitalize">{p.genericName}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">Rs. {Number(p.maxPrice).toFixed(2)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                    <button onClick={() => handleEdit(p)} className="text-indigo-600 hover:text-indigo-900" title="Edit">
                        <Edit2 className="w-4 h-4"/>
                    </button>
                    <button onClick={() => handleDelete(p._id)} className="text-red-600 hover:text-red-900" title="Delete">
                        <Trash2 className="w-4 h-4"/>
                    </button>
                  </td>
                </tr>
              ))}
              {prices.length === 0 && <tr><td colSpan="3" className="text-center py-4 text-gray-500">No NMRA price caps found</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default NmraPriceManager;