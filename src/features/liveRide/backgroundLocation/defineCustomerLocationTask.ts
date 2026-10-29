import * as TaskManager from 'expo-task-manager';

import { CUSTOMER_LOCATION_TASK, handleCustomerLocationTask } from './customerLocationSharing';

// The customer's location task executor, defined at module scope while the
// JS bundle first runs (see defineDriverLocationTask.ts for why). Loaded from
// the app entry (index.js) through registerCustomerLocationTask.ts, never
// imported directly: importing expo-task-manager throws in a binary without
// its native module.
TaskManager.defineTask(CUSTOMER_LOCATION_TASK, handleCustomerLocationTask);
