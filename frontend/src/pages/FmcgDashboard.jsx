import React, { useState, useEffect } from 'react';
import { Package, ShoppingCart, AlertCircle, X, PlusCircle, Activity, Calendar, ArrowUpRight, ArrowDownRight, Minus, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';

const SkeletonLoader = () => (
  <div className="animate-pulse space-y-6 w-full">
    <div className="rounded-2xl bg-slate-900 border border-slate-700 shadow-lg h-[400px]"></div>
  </div>
);

const FmcgDashboard = ({ refreshTrigger }) => {
    const [showPoSuggestions, setShowPoSuggestions] = useState(false);
    const [poModal, setPoModal] = useState({ isOpen: false, data: null });
    const [poForm, setPoForm] = useState({ supplier: '', unitCost: '' });
    const [supplierSearch, setSupplierSearch] = useState('');
    const [isSupplierDropdownOpen, setIsSupplierDropdownOpen] = useState(false);
    const [suppliers, setSuppliers] = useState([]);
    const [products, setProducts] = useState([]);

    const [compareYear, setCompareYear] = useState(new Date().getFullYear());
    const [compareMonth, setCompareMonth] = useState(new Date().getMonth() + 1);
    const [compareData, setCompareData] = useState(null);
    const [loadingCompare, setLoadingCompare] = useState(false);
    const [compareError, setCompareError] = useState('');

    const fetchCompareData = async () => {
        setLoadingCompare(true);
        setCompareError('');
        setCompareData(null);
        
        try {
            const response = await fetch(`http://localhost:8000/api/ml/fmcg-clustering/monthly-compare?year=${compareYear}&month=${compareMonth}`);
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.detail || 'Failed to fetch comparison data');
            }
            const data = await response.json();
            setCompareData(data);
        } catch (err) {
            setCompareError(err.message);
        } finally {
            setLoadingCompare(false);
        }
    };

    useEffect(() => {
        fetchCompareData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [compareYear, compareMonth, refreshTrigger]);

    useEffect(() => {
        const fetchInventoryData = async () => {
            try {
                const token = localStorage.getItem('token');
                const headers = { 'Authorization': `Bearer ${token}` };
                const [supRes, prodRes] = await Promise.all([
                    fetch('/api/inventory/suppliers', { headers }),
                    fetch('/api/inventory', { headers })
                ]);
                if (supRes.ok) setSuppliers(await supRes.json());
                if (prodRes.ok) setProducts(await prodRes.json());
            } catch (err) {
                console.error("Failed to fetch inventory data for POs", err);
            }
        };
        fetchInventoryData();
    }, []);

    const hasData = compareData && compareData.data && compareData.data.length > 0;

    const poSuggestions = hasData 
        ? compareData.data.filter(item => item.currentClass === 'Fast').map(item => ({ 
            ...item, 
            suggestedQty: item.totalQuantity 
        }))
        : [];

    const handlePoSubmit = async (e) => {
        e.preventDefault();
        
        try {
            const matchedProduct = products.find(p => p.name === poModal.data?.productName);
            if (!matchedProduct) {
                toast.error(`Error: Product "${poModal.data?.productName}" not found in inventory database.`);
                return;
            }

            if (!poForm.supplier) {
                toast.error("Please select a supplier.");
                return;
            }

            const newPO = {
                supplier: poForm.supplier,
                items: [{
                    product: matchedProduct._id,
                    quantity: poModal.data.suggestedQty,
                    unitCost: Number(poForm.unitCost)
                }]
            };

            const token = localStorage.getItem('token');
            const res = await fetch('/api/inventory/purchase-orders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(newPO)
            });

            if (!res.ok) throw new Error((await res.json()).message || 'Failed to create PO');

            toast.success(`Purchase Order successfully created for ${poModal.data?.productName}!`);
            setPoModal({ isOpen: false, data: null });
            setPoForm({ supplier: '', unitCost: '' });
            setSupplierSearch('');
        } catch (err) {
            toast.error(err.message);
        }
    };

    return (
        <div className="bg-slate-900 p-6 rounded-2xl border border-slate-700 shadow-lg mb-8 min-h-[500px]">
            <div className="flex flex-col md:flex-row md:justify-between md:items-start mb-6 gap-6">
                <div>
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold text-white flex items-center gap-3 tracking-wide">
                            <Package className="w-6 h-6 text-cyan-400" />
                            FMCG K-Means Analysis
                        </h2>
                    </div>
                    <p className="text-base text-gray-400 mt-2 font-bold">
                        Compares product movement categories between {compareMonth}/{compareYear} and the previous month.
                    </p>
                </div>
            </div>

            {hasData && (
                <div className="flex justify-end mb-6">
                    <button 
                        onClick={() => setShowPoSuggestions(!showPoSuggestions)}
                        className={`flex items-center px-5 py-2.5 rounded-lg shadow-sm transition-colors text-sm font-black whitespace-nowrap ${
                            showPoSuggestions 
                            ? 'bg-slate-800 text-gray-300 hover:text-white border border-slate-600' 
                            : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                        }`}
                    >
                        {showPoSuggestions ? <X className="w-5 h-5 mr-2 stroke-[3]" /> : <ShoppingCart className="w-5 h-5 mr-2 stroke-[3]" />}
                        {showPoSuggestions ? 'Hide PO Suggestions' : 'Suggest Purchase Orders'}
                    </button>
                </div>
            )}

            {showPoSuggestions && hasData && poSuggestions.length > 0 && (
                <div className="mb-8 bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                    <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-3 tracking-wide">
                        <ShoppingCart className="w-6 h-6 text-cyan-400" />
                        Suggested 30-Day Restock (Fast Moving Only)
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {poSuggestions.map((item, idx) => (
                            <div key={idx} className="bg-slate-900 p-6 rounded-xl border border-slate-700 shadow-md flex flex-col justify-between border-t-4 border-t-amber-400 hover:shadow-xl transition-shadow">
                                <div className="flex justify-between items-start mb-6">
                                    <div className="flex-1 min-w-0 mr-4">
                                        <p className="font-black text-white text-lg truncate" title={item.productName}>{item.productName}</p>
                                        <p className="text-sm text-gray-400 mt-1 font-bold">30d Vol: {item.totalQuantity.toLocaleString()}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Order Qty</p>
                                        <p className="text-3xl font-black text-amber-400">+{item.suggestedQty.toLocaleString()}</p>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => {
                                        setPoModal({ isOpen: true, data: item });
                                        setPoForm({ supplier: '', unitCost: '' });
                                        setSupplierSearch('');
                                    }} 
                                    className="w-full flex justify-center items-center py-3 px-4 rounded-md shadow-sm text-sm font-black text-slate-950 bg-cyan-500 hover:bg-cyan-400 transition-colors"
                                >
                                    <PlusCircle className="w-5 h-5 mr-2 stroke-[3]" />
                                    Create PO
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-gray-400" />
                    <select 
                        value={compareYear} 
                        onChange={e => setCompareYear(Number(e.target.value))} 
                        className="bg-slate-950 border border-slate-700 text-white p-2.5 rounded-md text-sm font-bold outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all"
                    >
                        {[...Array(5)].map((_, i) => {
                            const y = new Date().getFullYear() - i;
                            return <option key={y} value={y}>{y}</option>;
                        })}
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <select 
                        value={compareMonth} 
                        onChange={e => setCompareMonth(Number(e.target.value))} 
                        className="bg-slate-950 border border-slate-700 text-white p-2.5 rounded-md text-sm font-bold outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all"
                    >
                        {[...Array(12)].map((_, i) => (
                            <option key={i+1} value={i+1}>{new Date(0, i).toLocaleString('default', { month: 'long' })}</option>
                        ))}
                    </select>
                </div>
            </div>

            {compareError && (
                <div className="mb-6 rounded-md bg-slate-900 p-5 border-l-4 border-orange-500 shadow-md">
                    <div className="flex">
                        <AlertCircle className="h-6 w-6 text-orange-500 mr-3 flex-shrink-0" />
                        <div className="text-base text-white font-bold"><span className="font-black">Error:</span> {compareError}</div>
                    </div>
                </div>
            )}

            {loadingCompare && <SkeletonLoader />}

            {!loadingCompare && !compareError && compareData && compareData.data && (
                compareData.data.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 rounded-2xl border-4 border-slate-700 border-dashed bg-slate-900">
                        <h3 className="text-xl font-bold text-white tracking-wide">No Comparison Data Available</h3>
                        <p className="text-gray-400 text-base mt-2 font-bold">Try selecting a different month or year.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-700 shadow-sm">
                        <table className="min-w-full divide-y divide-slate-700 text-left">
                            <thead className="bg-slate-800">
                                <tr>
                                    <th className="px-6 py-4 text-sm font-bold text-gray-300 uppercase tracking-wider">Product Name</th>
                                    <th className="px-6 py-4 text-sm font-bold text-gray-300 uppercase tracking-wider">Total Sold</th>
                                    <th className="px-6 py-4 text-sm font-bold text-gray-300 uppercase tracking-wider">Previous Class</th>
                                    <th className="px-6 py-4 text-sm font-bold text-gray-300 uppercase tracking-wider">Current Class</th>
                                    <th className="px-6 py-4 text-sm font-bold text-gray-300 uppercase tracking-wider">Trend</th>
                                </tr>
                            </thead>
                            <tbody className="bg-slate-900 divide-y divide-slate-700">
                                {compareData.data.map((item, idx) => (
                                    <tr key={idx} className={`hover:bg-slate-800 transition-colors ${item.criticalDrop ? 'bg-red-900/10' : ''}`}>
                                        <td className="px-6 py-5 whitespace-nowrap text-base font-bold text-white">
                                            <div className="flex items-center gap-2">
                                                {item.productName}
                                                {item.criticalDrop && (
                                                    <span className="flex items-center gap-1 text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded border border-red-500/30">
                                                        <AlertCircle className="w-3 h-3" /> Critical Drop
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-5 whitespace-nowrap">
                                            <span className="inline-flex items-center px-3 py-1 rounded text-sm font-black bg-slate-800 text-gray-100 border border-slate-600 shadow-sm">
                                                {item.totalQuantity.toLocaleString()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 whitespace-nowrap text-base text-gray-400 font-bold">
                                            <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-black shadow-sm ${
                                                item.previousClass === 'Fast' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' :
                                                item.previousClass === 'Normal' ? 'bg-slate-600/50 text-gray-300 border border-slate-600' :
                                                item.previousClass === 'None' ? 'bg-gray-800 text-gray-500 border border-gray-700' :
                                                'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                                            }`}>
                                                {item.previousClass}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 whitespace-nowrap">
                                            <span className={`inline-flex items-center px-3 py-1 rounded text-sm font-black shadow-sm ${
                                                item.currentClass === 'Fast' ? 'bg-cyan-500 text-slate-950' :
                                                item.currentClass === 'Normal' ? 'bg-slate-600 text-white' :
                                                'bg-orange-500 text-slate-950'
                                            }`}>
                                                {item.currentClass}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 whitespace-nowrap">
                                            <span className={`inline-flex items-center px-3 py-1 rounded text-sm font-black shadow-sm ${
                                                item.trend === 'Upward' ? 'text-green-400 bg-green-400/10 border border-green-400/20' :
                                                item.trend === 'Downward' ? 'text-red-400 bg-red-400/10 border border-red-400/20' :
                                                item.trend === 'New Entry' ? 'text-blue-400 bg-blue-400/10 border border-blue-400/20' :
                                                'text-gray-400 bg-gray-400/10 border border-gray-400/20'
                                            }`}>
                                                {item.trend === 'Upward' && <ArrowUpRight className="w-4 h-4 mr-1.5" />}
                                                {item.trend === 'Downward' && <ArrowDownRight className="w-4 h-4 mr-1.5" />}
                                                {item.trend === 'Stable' && <Minus className="w-4 h-4 mr-1.5" />}
                                                {item.trend === 'New Entry' && <Sparkles className="w-4 h-4 mr-1.5" />}
                                                {item.trend}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )
            )}

            {/* Create PO Modal */}
            {poModal.isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm transition-opacity">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-4">
                            <h3 className="text-xl font-black text-white flex items-center gap-3 tracking-wide">
                                <PlusCircle className="w-6 h-6 text-cyan-400" />
                                Create Purchase Order
                            </h3>
                            <button onClick={() => setPoModal({ isOpen: false, data: null })} className="text-gray-400 hover:text-white transition-colors p-2 rounded-full hover:bg-slate-800">
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        
                        <form onSubmit={handlePoSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-gray-400 mb-1">Product</label>
                                <input 
                                    type="text" 
                                    disabled 
                                    value={poModal.data?.productName || ''} 
                                    className="w-full bg-slate-800 border border-slate-600 text-gray-300 rounded-lg p-2.5 outline-none cursor-not-allowed"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-400 mb-1">Quantity</label>
                                <input 
                                    type="number" 
                                    disabled 
                                    value={poModal.data?.suggestedQty || 0} 
                                    className="w-full bg-slate-800 border border-slate-600 text-gray-300 rounded-lg p-2.5 outline-none cursor-not-allowed font-black"
                                />
                            </div>
                            <div className="relative">
                                <label className="block text-sm font-bold text-gray-400 mb-1">Supplier</label>
                                <input 
                                    type="text"
                                    value={supplierSearch}
                                    onChange={(e) => {
                                        setSupplierSearch(e.target.value);
                                        setPoForm({ ...poForm, supplier: '' }); 
                                        setIsSupplierDropdownOpen(true);
                                    }}
                                    onFocus={() => setIsSupplierDropdownOpen(true)}
                                    onBlur={() => setTimeout(() => setIsSupplierDropdownOpen(false), 200)}
                                    placeholder="Search supplier..."
                                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-cyan-500"
                                    required={!poForm.supplier}
                                />
                                {isSupplierDropdownOpen && (
                                    <ul className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg max-h-48 overflow-y-auto custom-scrollbar">
                                        {suppliers.filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase())).length > 0 ? (
                                            suppliers.filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase())).map(s => (
                                                <li 
                                                    key={s._id} 
                                                    onMouseDown={() => { setPoForm({ ...poForm, supplier: s._id }); setSupplierSearch(s.name); setIsSupplierDropdownOpen(false); }}
                                                    className="px-4 py-2.5 hover:bg-slate-700 cursor-pointer text-gray-200 font-medium transition-colors border-b border-slate-700/50 last:border-0"
                                                >
                                                    {s.name}
                                                </li>
                                            ))
                                        ) : (
                                            <li className="px-4 py-2.5 text-gray-500 italic text-sm font-medium">No suppliers found</li>
                                        )}
                                    </ul>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-400 mb-1">Estimated Unit Cost (Rs.)</label>
                                <input 
                                    type="number" 
                                    min="0"
                                    step="0.01"
                                    required
                                    value={poForm.unitCost}
                                    onChange={(e) => setPoForm({...poForm, unitCost: e.target.value})}
                                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-cyan-500"
                                    placeholder="0.00"
                                />
                            </div>
                            <div className="pt-4 flex justify-end gap-3">
                                <button 
                                    type="button" 
                                    onClick={() => setPoModal({ isOpen: false, data: null })}
                                    className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 font-bold transition-colors"
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit" 
                                    className="px-4 py-2 bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 font-black transition-colors"
                                >
                                    Confirm PO
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FmcgDashboard;