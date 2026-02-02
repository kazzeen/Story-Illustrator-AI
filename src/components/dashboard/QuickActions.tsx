import { Card, CardContent } from "@/components/ui/card";
import { Upload, PenTool } from "lucide-react";
import { Link } from "react-router-dom";

const actions = [
  {
    icon: PenTool,
    title: "Create Story",
    description: "AI-generated stories",
    href: "/create-story",
    color: "text-violet-400",
    bgColor: "bg-violet-400/10",
  },
  {
    icon: Upload,
    title: "Import Story",
    description: "PDF, DOCX, ePub, TXT",
    href: "/import",
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
];

export function QuickActions() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {actions.map((action) => (
        <Link key={action.title} to={action.href}>
          <Card
            variant="interactive"
            className="h-full hover:border-primary/30"
          >
            <CardContent className="p-5 flex flex-col items-center text-center">
              <div
                className={`w-12 h-12 rounded-xl ${action.bgColor} flex items-center justify-center mb-3`}
              >
                <action.icon className={`w-6 h-6 ${action.color}`} />
              </div>
              <h3 className="font-semibold text-foreground mb-1">
                {action.title}
              </h3>
              <p className="text-xs text-muted-foreground">
                {action.description}
              </p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
