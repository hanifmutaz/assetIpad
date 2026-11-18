export interface DeviceListPosition { top: number; left: number }

export interface DeviceListNavigationState {
  deviceListReturn?: DeviceListPosition & { search: string };
  deviceListPosition?: DeviceListPosition;
}

// The browser Back button returns to the original history entry for the list.
export const deviceListPositions = new Map<string, DeviceListPosition>();
