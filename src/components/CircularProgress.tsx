import { motion } from "framer-motion";

interface CircularProgressProps {
  progress: number;
  size?: number;
  strokeWidth?: number;
  status?: string;
}

const CircularProgress = ({ progress, size = 90, strokeWidth = 5, status }: CircularProgressProps) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <motion.div
        className="relative"
        style={{ width: size, height: size }}
        animate={{ scale: [1, 1.03, 1] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
      >
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="hsl(var(--secondary))"
            strokeWidth={strokeWidth}
            opacity={0.5}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-700 ease-out"
            style={{
              filter: "drop-shadow(0 0 6px hsl(var(--primary) / 0.5))",
            }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-base font-bold text-foreground">{Math.round(progress)}%</span>
        </div>
      </motion.div>
      {status && (
        <motion.p
          className="text-[11px] text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {status}
        </motion.p>
      )}
    </div>
  );
};

export default CircularProgress;
