/**
 * Battery Status API Type Definitions
 * Provides typed access to the deprecated but still useful Battery API
 */

export interface BatteryStatus {
    /**
     * Battery level as a percentage (0.0 to 1.0)
     */
    level: number;

    /**
     * Whether the device is currently charging
     */
    charging: boolean;

    /**
     * Time in seconds until battery is fully charged
     * (Infinity if not charging)
     */
    chargingTime: number;

    /**
     * Time in seconds until battery is fully depleted
     * (Infinity if charging)
     */
    dischargingTime: number;

    /**
     * Add event listener for battery status changes
     */
    addEventListener(
        type: 'levelchange' | 'chargingchange' | 'chargingtimechange' | 'dischargingtimechange',
        listener: EventListener
    ): void;

    /**
     * Remove event listener for battery status changes
     */
    removeEventListener(
        type: 'levelchange' | 'chargingchange' | 'chargingtimechange' | 'dischargingtimechange',
        listener: EventListener
    ): void;
}

/**
 * Extend Navigator interface with Battery API
 */
declare global {
    interface Navigator {
        /**
         * Get battery status (deprecated but still useful for emergency apps)
         * @returns Promise resolving to BatteryStatus
         */
        getBattery?(): Promise<BatteryStatus>;
    }
}

export { };
