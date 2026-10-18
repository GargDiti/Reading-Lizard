import { Router } from "express";
import { getProfile, login, register } from "../controllers/authcontroller.js";
import authMiddleware from "../middleware/authmiddleware.js";

const router = Router();
router.post("/register", register);
router.post("/login", login);
router.get("/profile", authMiddleware, getProfile);

export default router;
