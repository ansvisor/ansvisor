import { cn } from '@/lib/utils';

/**
 * The Content Agent at work (v1.1 CE-035): three dots that bounce in turn, in
 * the text's color — never a spinning ring. Still with reduced motion.
 */
export function WorkingDots({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('ml-1.5 inline-flex gap-[3px] align-middle', className)}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 animate-agent-dot rounded-full bg-current opacity-25 motion-reduce:animate-none"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}
