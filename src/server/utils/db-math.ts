export const dbMath = {
    /**
     * Normalize a value to a safe number with 2 decimal places.
     * Handles undefined, null, strings, etc.
     */
    norm: (val: any): number => {
        const n = Number(val);
        if (!Number.isFinite(n)) return 0;
        return Number(n.toFixed(2));
    },

    /**
     * Add multiple numbers safely.
     * dbMath.add(0.1, 0.2) -> 0.30
     */
    add: (...nums: number[]): number => {
        const sum = nums.reduce((acc, curr) => acc + (Number(curr) || 0), 0);
        return Number(sum.toFixed(2));
    },

    /**
     * Subtract b from a safely.
     * dbMath.sub(10, 3.333) -> 6.67
     */
    sub: (a: number, b: number): number => {
        return Number(((Number(a) || 0) - (Number(b) || 0)).toFixed(2));
    },

    /**
     * Multiply a and b safely.
     */
    mult: (a: number, b: number): number => {
        return Number(((Number(a) || 0) * (Number(b) || 0)).toFixed(2));
    },

    /**
     * Divide a by b safely. Returns 0 if b is 0.
     */
    div: (a: number, b: number): number => {
        const divisor = Number(b) || 0;
        if (divisor === 0) return 0;
        return Number(((Number(a) || 0) / divisor).toFixed(2));
    }
};
