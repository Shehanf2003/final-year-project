import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext();

export const useSocket = () => {
  return useContext(SocketContext);
};

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001';
    const socketUrl = apiUrl.replace(/\/api\/?$/, '');
    const newSocket = io(socketUrl, {
      autoConnect: true,
      withCredentials: true,
    });

    setSocket(newSocket);

    // Implement ping-pong mechanism to prevent inactive tab disconnects
    const pingInterval = setInterval(() => {
      if (newSocket.connected) {
        newSocket.emit('CLIENT_PING');
      }
    }, 20000); // Emit a ping every 20 seconds

    newSocket.on('SERVER_PONG', () => {
      // The server has responded, confirming the connection is still alive
    });

    // Disconnect when the provider is unmounted
    return () => {
      clearInterval(pingInterval);
      newSocket.off('SERVER_PONG');
      newSocket.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
};