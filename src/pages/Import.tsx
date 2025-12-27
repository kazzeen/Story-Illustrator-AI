import { Layout } from "@/components/layout/Layout";
import { FileUpload } from "@/components/import/FileUpload";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Sparkles, Wand2 } from "lucide-react";

const steps = [
  {
    number: 1,
    title: "Upload Your Story",
    description: "Import PDF, DOCX, ePub, or TXT files",
    icon: FileText,
    status: "active" as const,
  },
  {
    number: 2,
    title: "AI Analysis",
    description: "Automatically detect scenes and characters",
    icon: Sparkles,
    status: "upcoming" as const,
  },
  {
    number: 3,
    title: "Generate Art",
    description: "Create stunning illustrations for each scene",
    icon: Wand2,
    status: "upcoming" as const,
  },
];

export default function Import() {
  return (
    <Layout>
      <div className="container mx-auto px-6 py-12">
        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-12">
          <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">
            Step 1 of 3
          </Badge>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-4">
            Import Your Story
          </h1>
          <p className="text-xl text-muted-foreground">
            Upload your story file and we'll prepare it for AI-powered illustration
          </p>
        </div>

        {/* Progress Steps */}
        <div className="max-w-3xl mx-auto mb-12">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <div key={step.number} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center mb-2 transition-all ${
                      step.status === "active"
                        ? "gradient-primary shadow-glow"
                        : "bg-secondary"
                    }`}
                  >
                    <step.icon
                      className={`w-6 h-6 ${
                        step.status === "active"
                          ? "text-primary-foreground"
                          : "text-muted-foreground"
                      }`}
                    />
                  </div>
                  <p
                    className={`font-medium text-sm ${
                      step.status === "active"
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    {step.title}
                  </p>
                  <p className="text-xs text-muted-foreground hidden sm:block">
                    {step.description}
                  </p>
                </div>
                {index < steps.length - 1 && (
                  <div className="w-16 sm:w-32 h-0.5 bg-secondary mx-4 mt-[-24px]" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* File Upload */}
        <div className="max-w-3xl mx-auto">
          <FileUpload />
        </div>

        {/* Tips Section */}
        <div className="max-w-3xl mx-auto mt-12">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                Tips for Best Results
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2" />
                  Use stories with clear scene breaks and descriptive passages for better AI analysis
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2" />
                  Longer stories (10,000+ words) typically produce more detailed storyboards
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2" />
                  Character descriptions in your story help create consistent illustrations
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2" />
                  You can always adjust scene breakdowns and prompts after analysis
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
