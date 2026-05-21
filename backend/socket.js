import { Server } from 'socket.io';

let io;

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:5173',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      credentials: true,
    },
    pingTimeout: 60000, // Wait 60 seconds before disconnecting a sluggish client
    pingInterval: 25000, // Send a ping every 25 seconds
  });

  io.on('connection', (socket) => {
    console.log(`Socket client connected: ${socket.id}`);

    // Respond to custom client pings to keep the connection active
    socket.on('CLIENT_PING', () => {
      socket.emit('SERVER_PONG');
    });

    // Relay live simulation updates to all connected frontends
    socket.on('SIMULATED_SALE', () => {
      io.emit('DASHBOARD_UPDATE');
      io.emit('STATS_UPDATE');
      io.emit('FINANCE_UPDATE');
    });

    socket.on('disconnect', () => {
      console.log(`Socket client disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    console.warn('Socket.io is not initialized yet!');
  }
  return io;
};