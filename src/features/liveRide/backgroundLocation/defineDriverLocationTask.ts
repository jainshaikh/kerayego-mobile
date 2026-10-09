import * as TaskManager from 'expo-task-manager';

import { DRIVER_LOCATION_TASK, handleDriverLocationTask } from './driverLocationSharing';

// expo-task-manager requires the task's executor to be defined at module
// scope, while the JS bundle first runs — not from a component — because the
// OS can start the app just to deliver locations, with no UI mounted. Loaded
// from the app entry (index.js) through registerDriverLocationTask.ts, never
// imported directly: importing expo-task-manager throws in a binary without
// its native module.
TaskManager.defineTask(DRIVER_LOCATION_TASK, handleDriverLocationTask);
