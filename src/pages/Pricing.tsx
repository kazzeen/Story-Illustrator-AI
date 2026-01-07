import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Check, X, HelpCircle, Zap, Star, Shield, Crown, Sparkles, CheckCircle2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";

export function formatUsd(value: number, locale: string = "en-US") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const plans = [
  {
    name: "Free",
    price: 0,
    description: "Perfect for trying out SIAI",
    features: [
      "5 free onboarding images",
      "1 story generation",
      "Basic models only",
      "Standard support"
    ],
    limitations: [
      "Limited art styles",
      "Watermarked images",
      "No commercial rights"
    ],
    cta: "Start for Free",
    ctaVariant: "outline" as const,
    href: "/auth?mode=signup",
    highlight: false,
    color: "bg-slate-100 dark:bg-slate-900"
  },
  {
    name: "Starter",
    price: 4.99,
    description: "For hobbyists and beginners",
    features: [
      "50-70 images/credits per month",
      "20 first-time bonus credits",
      "5 story generations",
      "Nano Banana Standard Model",
      "Standard art styles",
      "Commercial rights"
    ],
    cta: "Get Started",
    ctaVariant: "default" as const,
    href: "/auth?mode=signup&plan=starter",
    highlight: false,
    color: "bg-blue-50/50 dark:bg-blue-950/20",
    valueText: "~$0.08 / credit"
  },
  {
    name: "Creator",
    price: 14.99,
    description: "For serious storytellers",
    features: [
      "200-300 images/credits per month",
      "100 first-time bonus credits",
      "25 story generations",
      "All Models (Nano Banana Pro, Venice.ai)",
      "All Art Styles available",
      "Priority generation queue"
    ],
    cta: "Upgrade to Creator",
    ctaVariant: "hero" as const,
    href: "/auth?mode=signup&plan=creator",
    highlight: true,
    badge: "Popular Choice",
    color: "bg-primary/5 dark:bg-primary/10 border-primary/50",
    valueText: "~$0.06 / credit"
  },
  {
    name: "Professional",
    price: 39.99,
    description: "Power users and studios",
    features: [
      "Unlimited images & stories",
      "All Models & Art Styles",
      "Dedicated support",
      "Custom feature requests",
      "Early access to new features",
      "API Access (beta)"
    ],
    cta: "Go Professional",
    ctaVariant: "default" as const,
    href: "/auth?mode=signup&plan=professional",
    highlight: false,
    badge: "Most Powerful",
    color: "bg-purple-50/50 dark:bg-purple-950/20",
    valueText: "Best Value"
  }
];

const featuresComparison = [
  {
    category: "Generation",
    features: [
      { name: "Monthly Credits", free: "5 (one-time)", starter: "50-70", creator: "200-300", pro: "Unlimited" },
      { name: "Story Generations", free: "1", starter: "5", creator: "25", pro: "Unlimited" },
      { name: "Bonus Credits", free: "-", starter: "20", creator: "100", pro: "-" },
    ]
  },
  {
    category: "Capabilities",
    features: [
      { name: "AI Models", free: "Basic", starter: "Nano Banana Std", creator: "All (Pro + Venice)", pro: "All + Future" },
      { name: "Art Styles", free: "Limited", starter: "Standard", creator: "All Styles", pro: "All Styles" },
      { name: "Commercial Usage", free: false, starter: true, creator: true, pro: true },
      { name: "Watermark Free", free: false, starter: true, creator: true, pro: true },
    ]
  },
  {
    category: "Support",
    features: [
      { name: "Support Level", free: "Community", starter: "Standard", creator: "Priority", pro: "Dedicated" },
      { name: "Feature Requests", free: false, starter: false, creator: false, pro: true },
    ]
  }
];

const faqs = [
  {
    question: "How do credits work?",
    answer: "Credits are used to generate images. Different models and quality settings may consume different amounts of credits. Your monthly allowance resets every billing cycle."
  },
  {
    question: "Can I cancel anytime?",
    answer: "Yes, you can cancel your subscription at any time. Your access will continue until the end of your current billing period."
  },
  {
    question: "What happens to unused credits?",
    answer: "For Starter and Creator plans, a portion of unused credits rolls over to the next month, up to a maximum limit equivalent to your monthly allowance."
  },
  {
    question: "What is the difference between Nano Banana Standard and Pro?",
    answer: "Nano Banana Pro offers higher detail, better prompt adherence, and more complex composition capabilities compared to the Standard version."
  }
];

const creditPackages = [
  {
    name: "Small",
    price: 4.99,
    credits: 50,
    description: "Quick top-up for a small project",
    perCredit: "$0.10/credit",
    highlight: false
  },
  {
    name: "Medium",
    price: 14.99,
    credits: 200,
    description: "Best for ongoing stories",
    perCredit: "$0.07/credit",
    highlight: true,
    badge: "Best Value"
  },
  {
    name: "Large",
    price: 24.99,
    credits: 400,
    description: "Maximum bulk savings",
    perCredit: "$0.06/credit",
    highlight: false
  }
];

export default function Pricing() {
  const [isAnnual, setIsAnnual] = useState(true);

  const starterCreditCost = formatUsd(isAnnual ? 0.08 : 0.1);

  const calculatePrice = (price: number) => {
    if (price === 0) return "Free";
    if (isAnnual) return `$${(price * 0.8).toFixed(2)}`;
    return `$${price}`;
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16 space-y-24">
        {/* Header */}
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <Badge variant="secondary" className="mb-4">
            <Sparkles className="w-3 h-3 mr-1" />
            Simple Pricing
          </Badge>
          <h1 className="font-display text-4xl md:text-5xl font-bold">
            Choose the perfect plan for your story
          </h1>
          <p className="text-xl text-muted-foreground">
            Start for free and upgrade as you grow. Unlock more power, styles, and capabilities.
          </p>
          
          <div className="flex items-center justify-center gap-4 pt-8">
            <span className={cn("text-sm font-medium", !isAnnual && "text-foreground", isAnnual && "text-muted-foreground")}>Monthly</span>
            <Switch
              checked={isAnnual}
              onCheckedChange={setIsAnnual}
            />
            <span className={cn("text-sm font-medium", isAnnual && "text-foreground", !isAnnual && "text-muted-foreground")}>
              Annual <span className="text-green-500 font-bold ml-1">(Save 20%)</span>
            </span>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
          {plans.map((plan) => (
            <Card 
              key={plan.name} 
              className={cn(
                "relative flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-xl",
                plan.highlight ? "border-primary shadow-lg scale-105 z-10" : "border-border"
              )}
            >
              {plan.badge && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground px-4 py-1">
                    {plan.badge}
                  </Badge>
                </div>
              )}
              
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {plan.name}
                  {plan.name === "Professional" && <Crown className="w-5 h-5 text-purple-500" />}
                </CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold">{calculatePrice(plan.price)}</span>
                  {plan.price > 0 && <span className="text-muted-foreground">/mo</span>}
                  {(plan.valueText || plan.name === "Starter") && (
                    <div
                      key={plan.name === "Starter" ? (isAnnual ? "annual" : "monthly") : plan.valueText}
                      className="text-sm text-muted-foreground mt-1 font-medium text-green-600 dark:text-green-400 animate-in fade-in duration-200"
                    >
                      {plan.name === "Starter" ? `${starterCreditCost} per credit` : plan.valueText}
                    </div>
                  )}
                </div>
              </CardHeader>

              <CardContent className="flex-1 space-y-4">
                <div className="space-y-2">
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                      <span>{feature}</span>
                    </div>
                  ))}
                  {plan.limitations?.map((limitation) => (
                    <div key={limitation} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <X className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{limitation}</span>
                    </div>
                  ))}
                </div>
              </CardContent>

              <CardFooter>
                <Button 
                  className="w-full" 
                  variant={plan.ctaVariant}
                  size="lg"
                  asChild
                >
                  <Link to={plan.href}>{plan.cta}</Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>

        {/* Credit Packages */}
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold mb-4">Need More Credits?</h2>
            <p className="text-muted-foreground">Top up your account with on-demand credit packs. No expiration on purchased credits.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {creditPackages.map((pack) => (
              <Card 
                key={pack.name}
                className={cn(
                  "relative flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-lg",
                  pack.highlight ? "border-primary/50 shadow-md" : "border-border"
                )}
              >
                {pack.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                      {pack.badge}
                    </Badge>
                  </div>
                )}
                <CardHeader className="text-center pb-2">
                  <CardTitle className="text-xl">{pack.name}</CardTitle>
                  <CardDescription>{pack.description}</CardDescription>
                </CardHeader>
                <CardContent className="text-center pb-2">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <span className="text-3xl font-bold">${pack.price}</span>
                  </div>
                  <div className="text-sm font-medium text-muted-foreground mb-4">
                    {pack.credits} Credits
                  </div>
                  <div className="inline-block bg-secondary/50 px-3 py-1 rounded-full text-xs text-muted-foreground">
                    {pack.perCredit}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full" asChild>
                    <Link to="/auth?mode=signup">Buy {pack.credits} Credits</Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>

        {/* Feature Comparison */}
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold mb-4">Compare Features</h2>
            <p className="text-muted-foreground">Detailed breakdown of what's included in each plan</p>
          </div>
          
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader className="bg-secondary/30">
                <TableRow>
                  <TableHead className="w-[200px]">Feature</TableHead>
                  <TableHead>Free</TableHead>
                  <TableHead>Starter</TableHead>
                  <TableHead className="text-primary font-bold">Creator</TableHead>
                  <TableHead>Professional</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {featuresComparison.map((section) => (
                  <>
                    <TableRow key={section.category} className="bg-secondary/10 hover:bg-secondary/10">
                      <TableCell colSpan={5} className="font-semibold text-muted-foreground pl-4 py-2">
                        {section.category}
                      </TableCell>
                    </TableRow>
                    {section.features.map((feature) => (
                      <TableRow key={feature.name}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {feature.name}
                            <Tooltip>
                              <TooltipTrigger>
                                <HelpCircle className="w-3 h-3 text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Details about {feature.name}</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                        <TableCell>
                          {typeof feature.free === "boolean" ? (
                            feature.free ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-muted-foreground" />
                          ) : feature.free}
                        </TableCell>
                        <TableCell>
                          {typeof feature.starter === "boolean" ? (
                            feature.starter ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-muted-foreground" />
                          ) : feature.starter}
                        </TableCell>
                        <TableCell className="bg-primary/5">
                          {typeof feature.creator === "boolean" ? (
                            feature.creator ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-muted-foreground" />
                          ) : feature.creator}
                        </TableCell>
                        <TableCell>
                          {typeof feature.pro === "boolean" ? (
                            feature.pro ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-muted-foreground" />
                          ) : feature.pro}
                        </TableCell>
                      </TableRow>
                    ))}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Testimonials */}
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {[
            {
              quote: "The character consistency is mind-blowing. It saved me weeks of work on my graphic novel.",
              author: "Sarah J.",
              role: "Indie Author"
            },
            {
              quote: "Finally, an AI tool that actually understands story continuity. The Creator tier is worth every penny.",
              author: "Mike R.",
              role: "Storyboard Artist"
            },
            {
              quote: "I use the Professional plan for my studio. The dedicated support and API access have streamlined our workflow.",
              author: "Elena V.",
              role: "Creative Director"
            }
          ].map((testimonial, i) => (
            <Card key={i} className="bg-secondary/20 border-none">
              <CardContent className="pt-6">
                <div className="flex gap-1 mb-4">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                  ))}
                </div>
                <p className="mb-4 italic">"{testimonial.quote}"</p>
                <div>
                  <p className="font-semibold">{testimonial.author}</p>
                  <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="font-display text-3xl font-bold mb-4">Frequently Asked Questions</h2>
          </div>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, i) => (
              <AccordionItem key={i} value={`item-${i}`}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {/* Money Back Guarantee */}
        <div className="text-center py-12">
          <div className="inline-flex items-center gap-2 bg-secondary/30 px-4 py-2 rounded-full text-sm font-medium">
            <Shield className="w-4 h-4 text-green-500" />
            14-day money-back guarantee on all paid plans
          </div>
        </div>
      </div>
    </Layout>
  );
}
