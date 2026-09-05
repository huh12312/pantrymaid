import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

/**
 * No AI key configured (plan §5.7). Deliberately has NO generate button at all — a
 * disabled button with a tooltip teaches worse than a direct path to the one thing
 * that actually unblocks the user.
 */
export function AiSetupPrompt() {
  return (
    <Card className="mx-auto max-w-lg text-center">
      <CardHeader className="items-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-6 w-6" aria-hidden="true" />
        </div>
        <CardTitle>Set up AI meal planning</CardTitle>
        <CardDescription>
          Add your household&apos;s AI provider key in Settings to generate a week of meals from
          what&apos;s already in your pantry.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to="/settings#ai">Go to Settings</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
