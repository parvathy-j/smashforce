// booking.js loader for HTML inline script compatibility
// Ensures booking.js functions are available globally for inline onclick handlers
import * as booking from "./booking.js";
window.selectFacility = booking.selectFacility;
window.selectCourt = booking.selectCourt;
window.selectTable = booking.selectTable;
window.setDuration = booking.setDuration;
window.step1Next = booking.step1Next;
window.step2Next = booking.step2Next;
window.step3Next = booking.step3Next;
window.goStep = booking.goStep;
window.maybeGoStep = booking.maybeGoStep;
