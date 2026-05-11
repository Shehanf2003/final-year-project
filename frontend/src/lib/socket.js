import { io } from 'socket.io-client';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001';
const socketUrl = apiUrl.replace(/\/api\/?$/, ''); 

export const socket = io(socketUrl, {
    autoConnect: true,
    withCredentials: true,
});

socket.on('connect', () => {
    console.log('Connected to Socket.IO Server:', socket.id);
});

socket.on('disconnect', () => {
    console.log('Disconnected from Socket.IO Server');
});