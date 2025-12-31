import { Layout } from "@/components/layout/Layout";
import { StoryCard } from "@/components/dashboard/StoryCard";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { Stats } from "@/components/dashboard/Stats";
import { Button } from "@/components/ui/button";
import { Plus, ArrowRight, Sparkles, LogIn } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useStories } from "@/hooks/useStories";
import { Skeleton } from "@/components/ui/skeleton";

export default function Index() {
  const { user, loading: authLoading } = useAuth();
  const { stories, latestStoryImageById, loading: storiesLoading } = useStories();
  const navigate = useNavigate();

  const getStatusFromStoryStatus = (status: string): "draft" | "processing" | "complete" => {
    if (status === "completed") return "complete";
    if (["analyzing", "generating"].includes(status)) return "processing";
    return "draft";
  };

  const handleStoryGridClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button, a, input, textarea, select, [role='button']")) return;

    const container = target.closest("[data-story-id]") as HTMLElement | null;
    const storyId = container?.dataset?.storyId;
    if (!storyId) return;
    navigate(`/storyboard/${storyId}`);
  };

  const handleStoryGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button, a, input, textarea, select, [role='button']")) return;

    const container = target.closest("[data-story-id]") as HTMLElement | null;
    const storyId = container?.dataset?.storyId;
    if (!storyId) return;
    event.preventDefault();
    navigate(`/storyboard/${storyId}`);
  };

  return (
    <Layout>
      <div className="container mx-auto px-6 py-12">
        {/* Hero Section */}
        <section className="mb-16">
          <div className="max-w-4xl">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium text-primary">AI-Powered Storytelling</span>
            </div>
            <h1 className="font-display text-5xl md:text-6xl font-bold text-foreground mb-6 leading-tight">
              Transform Your Stories Into
              <span className="text-gradient"> Visual Masterpieces</span>
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
              Import your story, let AI analyze the scenes, and watch as stunning 
              illustrations bring your narrative to life. Create beautiful storyboards 
              with just a few clicks.
            </p>
            <div className="flex flex-wrap gap-4">
              {user ? (
                <Link to="/import">
                  <Button variant="hero" size="xl" className="gap-2">
                    <Plus className="w-5 h-5" />
                    Start New Story
                  </Button>
                </Link>
              ) : (
                <Link to="/auth">
                  <Button variant="hero" size="xl" className="gap-2">
                    <LogIn className="w-5 h-5" />
                    Sign In to Start
                  </Button>
                </Link>
              )}
              <Link to="/storyboard">
                <Button variant="outline" size="xl" className="gap-2">
                  View Demo
                  <ArrowRight className="w-5 h-5" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {user && (
          <>
            {/* Stats */}
            <section className="mb-12">
              <Stats 
                totalStories={stories.length}
                totalScenes={stories.reduce((acc, s) => acc + s.scene_count, 0)}
                completedStories={stories.filter(s => s.status === 'completed').length}
              />
            </section>

            {/* Quick Actions */}
            <section className="mb-12">
              <h2 className="font-display text-2xl font-semibold text-foreground mb-6">
                Quick Actions
              </h2>
              <QuickActions />
            </section>

            {/* Recent Stories */}
            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-display text-2xl font-semibold text-foreground">
                  Your Stories
                </h2>
                {stories.length > 4 && (
                  <Button variant="ghost" className="gap-2 text-primary">
                    View All
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                )}
              </div>
              
              {storiesLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-64 rounded-xl" />
                  ))}
                </div>
              ) : stories.length > 0 ? (
                <div
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
                  onClick={handleStoryGridClick}
                  onKeyDown={handleStoryGridKeyDown}
                >
                  {stories.slice(0, 8).map((story) => (
                    <div
                      key={story.id}
                      data-story-id={story.id}
                      role="link"
                      tabIndex={0}
                      aria-label={`Open story: ${story.title}`}
                      className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <StoryCard 
                        title={story.title}
                        author="You"
                        coverImage={latestStoryImageById[story.id]}
                        sceneCount={story.scene_count}
                        progress={story.scene_count > 0 ? Math.min(100, Math.round(((story.completed_scenes || 0) / story.scene_count) * 100)) : 0}
                        completedScenes={story.completed_scenes || 0}
                        lastEdited={new Date(story.updated_at).toLocaleDateString()}
                        status={getStatusFromStoryStatus(story.status)}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 bg-secondary/30 rounded-xl border border-border/50">
                  <p className="text-muted-foreground mb-4">No stories yet</p>
                  <Link to="/import">
                    <Button variant="hero" className="gap-2">
                      <Plus className="w-4 h-4" />
                      Import Your First Story
                    </Button>
                  </Link>
                </div>
              )}
            </section>
          </>
        )}

        {!user && !authLoading && (
          <section className="text-center py-16 bg-secondary/30 rounded-xl border border-border/50">
            <h2 className="font-display text-2xl font-semibold text-foreground mb-4">
              Ready to bring your stories to life?
            </h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Sign in to start creating AI-illustrated storyboards from your written stories.
            </p>
            <Link to="/auth">
              <Button variant="hero" size="lg" className="gap-2">
                <LogIn className="w-5 h-5" />
                Get Started Free
              </Button>
            </Link>
          </section>
        )}
      </div>
    </Layout>
  );
}
