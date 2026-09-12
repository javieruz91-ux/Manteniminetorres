import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import maintenanceRouter from "./maintenance";
import templatesRouter from "./templates";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(maintenanceRouter);
router.use(templatesRouter);

export default router;
