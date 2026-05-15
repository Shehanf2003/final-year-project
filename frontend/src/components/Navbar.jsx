import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (!user) return null; 

  return (
    <nav className="bg-slate-900 shadow-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          <div className="flex items-center">
            <Link to="/" className="flex items-center flex-shrink-0 group">
              <img src="/Navbar.png" alt="Pharma ERP Logo" className="h-20 w-auto" />
              <span className=" text-xl font-bold text-white tracking-tight group-hover:text-blue-400 transition-colors">
                Pharma ERP
              </span>
            </Link>
            
            <div className="hidden md:block">
              <div className="ml-10 flex items-baseline space-x-4">
                <Link 
                  to="/" 
                  className="text-gray-300 hover:bg-slate-800 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Dashboard
                </Link>
                
                {user.role === 'admin' && (
                  <Link 
                    to="/register-user" 
                    className="text-gray-300 hover:bg-slate-800 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors"
                  >
                    Register User
                  </Link>
                )}
              </div>
            </div>
          </div>

          <div className="hidden md:block">
            <div className="ml-4 flex items-center md:ml-6">
              
              <div className="flex flex-col items-end mr-4">
                <span className="text-sm font-medium text-white leading-none mb-1">
                  {user.name}
                </span>
                <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                  {user.role}
                </span>
              </div>

              <div className="h-9 w-9 rounded-full bg-slate-700 flex items-center justify-center text-white font-bold border-2 border-slate-600 shadow-sm">
                {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
              </div>

              <button
                onClick={handleLogout}
                className="ml-5 bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-red-500 shadow-sm"
              >
                Logout
              </button>
            </div>
          </div>
          
          <div className="-mr-2 flex md:hidden">
            <button className="bg-slate-800 inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-white hover:bg-slate-700 focus:outline-none">
              <svg className="block h-6 w-6" stroke="currentColor" fill="none" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>

        </div>
      </div>
    </nav>
  );
};

export default Navbar;
