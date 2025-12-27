import { BookOpen, Image, Sparkles, TrendingUp } from "lucide-react";

interface StatsProps {
  totalStories?: number;
  totalScenes?: number;
  completedStories?: number;
}

export function Stats({ totalStories = 0, totalScenes = 0, completedStories = 0 }: StatsProps) {
  const completionRate = totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;
  
  const stats = [
    {
      label: "Total Stories",
      value: totalStories.toString(),
      icon: BookOpen,
      color: "text-primary",
    },
    {
      label: "Scenes Illustrated",
      value: totalScenes.toString(),
      icon: Image,
      color: "text-accent",
    },
    {
      label: "Completed",
      value: completedStories.toString(),
      icon: Sparkles,
      color: "text-green-400",
    },
    {
      label: "Completion Rate",
      value: `${completionRate}%`,
      icon: TrendingUp,
      color: "text-blue-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="glass rounded-xl p-5 group hover:border-primary/30 transition-all duration-300"
        >
          <div className="flex items-start justify-between mb-3">
            <div
              className={`w-10 h-10 rounded-lg bg-secondary flex items-center justify-center ${stat.color}`}
            >
              <stat.icon className="w-5 h-5" />
            </div>
          </div>
          <div className="font-display text-3xl font-semibold text-foreground mb-1">
            {stat.value}
          </div>
          <div className="text-sm text-muted-foreground">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}
