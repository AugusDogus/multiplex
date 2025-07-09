import { TvGuideGridChild } from "./tv-guide-grid-child";
import { TvGuideGridParent } from "./tv-guide-grid-parent";

interface TvGuideTimeHeaderProps {
  startTime: Date;
  endTime: Date;
  isCompact?: boolean;
}

function calculateTimeSlots(startTime: Date, endTime: Date) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);

  // Use 30-minute increments for shorter durations, 60-minute for longer
  const increment = totalMinutes < 4 * 60 ? 30 : 60;
  const slotCount = Math.floor(totalMinutes / increment);

  const slots = [];
  for (let i = 0; i < slotCount; i++) {
    const slotTime = new Date(start.getTime() + i * increment * 60 * 1000);
    slots.push({
      time: slotTime,
      increment,
      index: i,
    });
  }

  return { slots, slotCount, increment };
}

function formatTimeSlot(time: Date, isCompact: boolean): string {
  if (isCompact) {
    return time.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return time.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function TvGuideTimeHeader({
  startTime,
  endTime,
  isCompact = false,
}: TvGuideTimeHeaderProps) {
  const { slots, slotCount } = calculateTimeSlots(startTime, endTime);

  // Calculate width for each time slot as percentage to fill full width
  const slotWidth = `${100 / slotCount}%`;

  return (
    <>
      {/* Time Slots */}
      <TvGuideGridParent className="flex">
        {slots.map((slot) => (
          <TvGuideGridChild
            key={slot.index}
            width={slotWidth}
            className="border-card flex h-8 items-center justify-center border-l text-center text-sm font-medium last:border-r"
          >
            {formatTimeSlot(slot.time, isCompact)}
          </TvGuideGridChild>
        ))}
      </TvGuideGridParent>
    </>
  );
}
