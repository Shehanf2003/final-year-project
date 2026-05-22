
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

const ModulePage = ({ name, endpoint }) => {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true); 

  useEffect(() => {
    const fetchData = async () => {
      
      setLoading(true);
      setError('');
      setMessage('');

      try {
        
         
        
        const res = await axios.get(endpoint);
        setMessage(res.data.message);
      } catch (err) {
        setError(err.response?.data?.message || 'Access Denied');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [endpoint]);

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-10">
      <div className="max-w-4xl mx-auto">
        
        {/* Header */}
        <div className="mb-8 border-b border-gray-200 pb-4">
          <h1 className="text-3xl font-bold text-gray-900">{name}</h1>
          <p className="mt-2 text-sm text-gray-500">
            Manage your {name.toLowerCase()} data and configurations here.
          </p>
        </div>

        {/* Content Card */}
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
          <div className="p-6">
            
            {/* Loading State */}
            {loading && (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="animate-spin h-8 w-8 text-blue-600 mb-4" />
                <p className="text-gray-500 text-sm font-medium">Loading {name} data...</p>
              </div>
            )}

            {/* Success Alert */}
            {!loading && message && (
              <div className="rounded-md bg-green-50 p-4 border-l-4 border-green-500">
                <div className="flex">
                  <div className="flex-shrink-0">
                    {/* Check Circle Icon */}
                    <CheckCircle className="h-5 w-5 text-green-400" />
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-green-800">Request Successful</h3>
                    <div className="mt-1 text-sm text-green-700">
                      {message}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Error Alert */}
            {!loading && error && (
              <div className="rounded-md bg-red-50 p-4 border-l-4 border-red-500">
                <div className="flex">
                  <div className="flex-shrink-0">
                    {/* X Circle Icon */}
                    <XCircle className="h-5 w-5 text-red-400" />
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">Error Loading Module</h3>
                    <div className="mt-1 text-sm text-red-700">
                      {error}
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Placeholder for future content when no messages exist */}
            {!loading && !message && !error && (
               <div className="text-center py-12 text-gray-400">
                  No data available for this module yet.
               </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModulePage;
