const mongoose = require('mongoose');

let isConnected = false;
let connectionAttempts = 0;
const maxConnectionAttempts = 3;

const connectDB = async () => {
  try {
    // Try MongoDB Atlas first
    const atlasUri = process.env.MONGODB_URI || 'mongodb+srv://cryptoquiz-cluster:cryptoquiz-cluster2025@cluster0.bh469j2.mongodb.net/cryptoquiz?retryWrites=true&w=majority&appName=Cluster0';
    
    // Fallback to local MongoDB
    const localUri = 'mongodb://localhost:27017/cryptoquiz';
    
    try {
      console.log('🔄 Attempting MongoDB Atlas connection...');
      
      // Test Atlas connection first
      await mongoose.connect(atlasUri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        bufferCommands: false
      });
      
      isConnected = true;
      console.log('✅ MongoDB Atlas connected successfully');
      
    } catch (atlasError) {
      console.warn('⚠️ MongoDB Atlas connection failed, trying local MongoDB...');
      console.warn('Atlas Error:', atlasError.message);
      
      // Disconnect from Atlas
      try {
        await mongoose.disconnect();
      } catch (disconnectError) {
        // Ignore disconnect errors
      }
      
               // Try local MongoDB
               try {
                 await mongoose.connect(localUri, {
                   maxPoolSize: 10,
                   serverSelectionTimeoutMS: 5000,
                   socketTimeoutMS: 45000,
                   bufferCommands: true,
                 });
        
        isConnected = true;
        console.log('✅ Local MongoDB connected successfully');
      } catch (localError) {
        console.warn('⚠️ Local MongoDB connection also failed:', localError.message);
        isConnected = false;
      }
    }

    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err.message);
      isConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ MongoDB disconnected');
      isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected');
      isConnected = true;
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      if (isConnected) {
        await mongoose.connection.close();
        console.log('🔌 MongoDB connection closed through app termination');
      }
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    isConnected = false;
    
    // In development mode, continue without database
    if (process.env.NODE_ENV !== 'production') {
      console.log('🔄 Continuing in development mode without database connection');
      console.log('📝 API endpoints will return mock data');
    } else {
      console.error('❌ Production mode requires database connection');
      process.exit(1);
    }
  }
};

// Export connection status
const getConnectionStatus = () => isConnected;

module.exports = { connectDB, getConnectionStatus };