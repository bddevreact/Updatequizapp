const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { body, param, validationResult } = require('express-validator');
const { authenticate, authenticateAdmin } = require('../utils/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input data',
        details: errors.array()
      }
    });
  }
  next();
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    const subfolder = req.route.path.includes('deposit') ? 'deposits' : 
                     req.route.path.includes('task') ? 'tasks' : 
                     req.route.path.includes('profile') ? 'profiles' : 'general';
    
    const fullPath = path.join(uploadPath, subfolder);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    
    cb(null, fullPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = process.env.ALLOWED_FILE_TYPES?.split(',') || ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx'];
  const fileExt = path.extname(file.originalname).toLowerCase().substring(1);
  
  if (allowedTypes.includes(fileExt)) {
    cb(null, true);
  } else {
    cb(new Error(`File type .${fileExt} is not allowed. Allowed types: ${allowedTypes.join(', ')}`), false);
  }
};

// Configure multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024, // 5MB
    files: 5 // Maximum 5 files per request
  }
});

// Error handling for multer
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'File size exceeds the maximum limit'
        }
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TOO_MANY_FILES',
          message: 'Too many files uploaded'
        }
      });
    }
  }
  
  if (error.message.includes('File type')) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_FILE_TYPE',
        message: error.message
      }
    });
  }
  
  next(error);
};

// @route   POST /api/upload/deposit-proof
// @desc    Upload deposit proof
// @access  Private
router.post('/deposit-proof',
  authenticate,
  upload.single('depositProof'),
  handleMulterError,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NO_FILE_UPLOADED',
            message: 'No file uploaded'
          }
        });
      }

      const userId = req.user._id;
      const file = req.file;

      // Process image if it's an image file
      if (file.mimetype.startsWith('image/')) {
        const processedPath = path.join(path.dirname(file.path), 'processed-' + path.basename(file.path));
        
        await sharp(file.path)
          .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toFile(processedPath);
        
        // Replace original with processed version
        fs.unlinkSync(file.path);
        fs.renameSync(processedPath, file.path);
      }

      const fileUrl = `/uploads/deposits/${path.basename(file.path)}`;

      logger.business('deposit_proof_uploaded', {
        userId,
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
        fileUrl
      });

      res.json({
        success: true,
        data: {
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          url: fileUrl,
          uploadedAt: new Date()
        },
        message: 'Deposit proof uploaded successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'upload_deposit_proof',
        userId: req.user._id
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to upload deposit proof'
        }
      });
    }
  }
);

// @route   POST /api/upload/task-proof
// @desc    Upload task completion proof
// @access  Private
router.post('/task-proof',
  authenticate,
  upload.array('taskProof', 5),
  handleMulterError,
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NO_FILES_UPLOADED',
            message: 'No files uploaded'
          }
        });
      }

      const userId = req.user._id;
      const files = req.files;
      const processedFiles = [];

      for (const file of files) {
        // Process image if it's an image file
        if (file.mimetype.startsWith('image/')) {
          const processedPath = path.join(path.dirname(file.path), 'processed-' + path.basename(file.path));
          
          await sharp(file.path)
            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toFile(processedPath);
          
          // Replace original with processed version
          fs.unlinkSync(file.path);
          fs.renameSync(processedPath, file.path);
        }

        const fileUrl = `/uploads/tasks/${path.basename(file.path)}`;

        processedFiles.push({
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          url: fileUrl,
          uploadedAt: new Date()
        });
      }

      logger.business('task_proof_uploaded', {
        userId,
        fileCount: files.length,
        files: processedFiles.map(f => f.filename)
      });

      res.json({
        success: true,
        data: {
          files: processedFiles,
          totalFiles: files.length,
          totalSize: files.reduce((sum, file) => sum + file.size, 0)
        },
        message: 'Task proof uploaded successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'upload_task_proof',
        userId: req.user._id
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to upload task proof'
        }
      });
    }
  }
);

// @route   POST /api/upload/profile-picture
// @desc    Upload profile picture
// @access  Private
router.post('/profile-picture',
  authenticate,
  upload.single('profilePicture'),
  handleMulterError,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NO_FILE_UPLOADED',
            message: 'No file uploaded'
          }
        });
      }

      const userId = req.user._id;
      const file = req.file;

      // Only allow image files for profile pictures
      if (!file.mimetype.startsWith('image/')) {
        // Delete the uploaded file
        fs.unlinkSync(file.path);
        
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_FILE_TYPE',
            message: 'Only image files are allowed for profile pictures'
          }
        });
      }

      // Process and resize image
      const processedPath = path.join(path.dirname(file.path), 'processed-' + path.basename(file.path));
      
      await sharp(file.path)
        .resize(300, 300, { fit: 'cover' })
        .jpeg({ quality: 90 })
        .toFile(processedPath);
      
      // Replace original with processed version
      fs.unlinkSync(file.path);
      fs.renameSync(processedPath, file.path);

      const fileUrl = `/uploads/profiles/${path.basename(file.path)}`;

      // Update user profile
      const User = require('../models/User');
      const user = await User.findById(userId);
      if (user) {
        // Delete old profile picture if exists
        if (user.avatar && user.avatar.startsWith('/uploads/profiles/')) {
          const oldPath = path.join(process.env.UPLOAD_PATH || './uploads', user.avatar.substring(1));
          if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        }
        
        user.avatar = fileUrl;
        await user.save();
      }

      logger.business('profile_picture_uploaded', {
        userId,
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        fileUrl
      });

      res.json({
        success: true,
        data: {
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          url: fileUrl,
          uploadedAt: new Date()
        },
        message: 'Profile picture uploaded successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'upload_profile_picture',
        userId: req.user._id
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to upload profile picture'
        }
      });
    }
  }
);

// @route   GET /api/upload/files/:filename
// @desc    Get uploaded file
// @access  Private
router.get('/files/:filename',
  authenticate,
  [
    param('filename').isString().trim().isLength({ min: 1 }).withMessage('Filename is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { filename } = req.params;
      const userId = req.user._id;

      // Security check: prevent directory traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_FILENAME',
            message: 'Invalid filename'
          }
        });
      }

      const uploadPath = process.env.UPLOAD_PATH || './uploads';
      const filePath = path.join(uploadPath, filename);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'File not found'
          }
        });
      }

      // Check file permissions (in a real app, you'd check if user has access to this file)
      const stats = fs.statSync(filePath);
      
      // For now, allow access to all authenticated users
      // In production, you'd implement proper access control

      // Set appropriate headers
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      };

      const contentType = mimeTypes[ext] || 'application/octet-stream';
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

      // Stream the file
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);

      logger.business('file_accessed', {
        userId,
        filename,
        fileSize: stats.size,
        contentType
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_file',
        userId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve file'
        }
      });
    }
  }
);

// @route   DELETE /api/upload/files/:filename
// @desc    Delete uploaded file
// @access  Private
router.delete('/files/:filename',
  authenticate,
  [
    param('filename').isString().trim().isLength({ min: 1 }).withMessage('Filename is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { filename } = req.params;
      const userId = req.user._id;

      // Security check: prevent directory traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_FILENAME',
            message: 'Invalid filename'
          }
        });
      }

      const uploadPath = process.env.UPLOAD_PATH || './uploads';
      const filePath = path.join(uploadPath, filename);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'File not found'
          }
        });
      }

      // Delete the file
      fs.unlinkSync(filePath);

      logger.business('file_deleted', {
        userId,
        filename
      });

      res.json({
        success: true,
        message: 'File deleted successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'delete_file',
        userId: req.user._id,
        params: req.params
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete file'
        }
      });
    }
  }
);

// @route   GET /api/upload/stats
// @desc    Get upload statistics (Admin only)
// @access  Private
router.get('/stats',
  authenticateAdmin,
  async (req, res) => {
    try {
      const uploadPath = process.env.UPLOAD_PATH || './uploads';
      
      const stats = {
        totalFiles: 0,
        totalSize: 0,
        filesByType: {},
        filesByFolder: {}
      };

      // Recursively scan upload directory
      function scanDirectory(dir) {
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
          const itemPath = path.join(dir, item);
          const stat = fs.statSync(itemPath);
          
          if (stat.isDirectory()) {
            scanDirectory(itemPath);
          } else {
            stats.totalFiles++;
            stats.totalSize += stat.size;
            
            const ext = path.extname(item).toLowerCase();
            stats.filesByType[ext] = (stats.filesByType[ext] || 0) + 1;
            
            const folder = path.basename(path.dirname(itemPath));
            stats.filesByFolder[folder] = (stats.filesByFolder[folder] || 0) + 1;
          }
        }
      }

      if (fs.existsSync(uploadPath)) {
        scanDirectory(uploadPath);
      }

      res.json({
        success: true,
        data: stats,
        message: 'Upload statistics retrieved successfully'
      });

    } catch (error) {
      logger.errorWithContext(error, { 
        operation: 'get_upload_stats',
        adminId: req.user._id
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve upload statistics'
        }
      });
    }
  }
);

module.exports = router;
