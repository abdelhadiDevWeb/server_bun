import multer from "multer";
import path from "path";
import { existsSync, mkdirSync } from "fs";

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = "uploads/images";
    
    // Create directory if it doesn't exist
    if (!existsSync(uploadPath)) {
      mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-random-originalname
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  },
});

// File filter - only images
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Type de fichier non autorisé. Seules les images (JPEG, PNG, WEBP, GIF) sont acceptées."));
  }
};

// Configure multer
export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max per file
  },
});

// Middleware for multiple images
export const uploadMultiple = upload.array("images", 10); // Max 10 images

// Middleware for single image
export const uploadSingle = upload.single("image");

// Configure storage for user profile images
const userImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = "uploads/users_images";
    
    // Create directory if it doesn't exist
    if (!existsSync(uploadPath)) {
      mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-random-originalname
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  },
});

// Configure multer for user images
export const uploadUserImage = multer({
  storage: userImageStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max per file
  },
});

// Middleware for single user profile image
export const uploadUserImageSingle = uploadUserImage.single("profileImage");
