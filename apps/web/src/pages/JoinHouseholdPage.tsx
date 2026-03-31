import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

export default function JoinHouseholdPage() {
  const navigate = useNavigate();
  const [inviteCode, setInviteCode] = useState("");

  const joinMutation = useMutation({
    mutationFn: () => api.joinHousehold(inviteCode),
    onSuccess: () => {
      navigate("/inventory");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    joinMutation.mutate();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/20 via-background to-secondary/20 p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Join Household</CardTitle>
          <CardDescription className="text-center">
            Enter the invite code to join an existing household
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="inviteCode">Invite Code</Label>
              <Input
                id="inviteCode"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Enter 6-digit code"
                required
              />
            </div>
            {joinMutation.error && (
              <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
                {joinMutation.error instanceof Error
                  ? joinMutation.error.message
                  : "Failed to join household"}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={joinMutation.isPending}>
              {joinMutation.isPending ? "Joining..." : "Join Household"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => navigate("/login")}
            >
              Back to Login
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
