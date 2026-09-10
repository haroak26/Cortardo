import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { CortardoLogoMark } from "@/components/CortardoLogo";

type Props = {
  currentStep: number;
  furthestStep: number;
  stepTitles: string[];
  stepSubtitles: string[];
  error?: string;
  onStepClick?: (index: number) => void;
  children: React.ReactNode;
};

const stepVariants = {
  enter: { opacity: 0, y: 10 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};

const stepTransition = { duration: 0.2, ease: [0.22, 1, 0.36, 1] };

export function AuthOnboardingShell({
  currentStep,
  furthestStep,
  stepTitles,
  stepSubtitles,
  error,
  onStepClick,
  children,
}: Props) {
  const { isOnline } = useNetworkStatus();
  const [dismissedError, setDismissedError] = useState(false);

  const displayError = error && !dismissedError ? error : null;

  useEffect(() => {
    if (error) setDismissedError(false);
  }, [error]);

  const handleStepClick = useCallback(
    (index: number) => {
      if (!onStepClick) return;
      if (index < furthestStep && index !== currentStep) {
        setDismissedError(false);
        onStepClick(index);
      }
    },
    [onStepClick, furthestStep, currentStep],
  );

  const totalSteps = stepTitles.length;

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden lds-auth-page">
      {/* Banners */}
      <div className="max-w-sm mx-auto w-full px-6 pt-6 space-y-2">
        {!isOnline && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-warning/10 border border-warning/20 text-[13px] font-medium text-warning">
            <WifiOff size={14} className="shrink-0" />
            You&apos;re offline. Some actions may not work until you reconnect.
          </div>
        )}
        <AnimatePresence>
          {displayError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-danger/[0.07] border border-danger/15">
                <AlertTriangle size={15} className="text-danger shrink-0 mt-0.5" />
                <p className="text-[13px] font-medium text-danger flex-1 leading-snug">{displayError}</p>
                <button
                  type="button"
                  onClick={() => setDismissedError(true)}
                  className="text-danger/50 hover:text-danger transition-colors shrink-0 mt-0.5"
                  aria-label="Dismiss error"
                >
                  <X size={14} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Step content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm space-y-7">
          <CortardoLogoMark size={22} />
          <div className="space-y-1">
            <h1 className="text-[22px] text-foreground font-medium tracking-[-0.4px] leading-tight">
              {stepTitles[currentStep]}
            </h1>
            {stepSubtitles[currentStep] && (
              <p className="text-[13px] text-fg-muted font-medium leading-snug">
                {stepSubtitles[currentStep]}
              </p>
            )}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={stepTransition}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom progress dots */}
      <div className="shrink-0 pb-8 flex items-center justify-center gap-1.5">
        {Array.from({ length: totalSteps }).map((_, i) => {
          const isCompleteOrCurrent = i <= currentStep;
          const isReachable = i < furthestStep && i !== currentStep;
          return (
            <button
              key={i}
              type="button"
              onClick={() => isReachable ? handleStepClick(i) : undefined}
              disabled={!isReachable && i !== currentStep}
              aria-label={`Step ${i + 1}: ${stepTitles[i]}`}
              aria-current={i === currentStep ? "step" : undefined}
              className={[
                "rounded-full transition-all duration-300",
                isCompleteOrCurrent ? "w-5 h-1.5 bg-foreground" : "w-1.5 h-1.5 bg-border",
                isReachable ? "cursor-pointer hover:bg-foreground/60" : "cursor-default",
              ].join(" ")}
            />
          );
        })}
      </div>
    </div>
  );
}
