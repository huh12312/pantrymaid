import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { RadarLogo } from "@/components/layout/RadarLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    name: "",
  });

  const loginMutation = useMutation({
    mutationFn: () => api.login(formData.email, formData.password),
    onSuccess: (data) => {
      setAuth(data.user);
      navigate("/inventory");
    },
  });

  const registerMutation = useMutation({
    mutationFn: () => api.register(formData.email, formData.password, formData.name),
    onSuccess: (data) => {
      setAuth(data.user);
      navigate("/inventory");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegister) {
      registerMutation.mutate();
    } else {
      loginMutation.mutate();
    }
  };

  const error = loginMutation.error || registerMutation.error;
  const isLoading = loginMutation.isPending || registerMutation.isPending;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative blobs */}
      <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-primary/5 blur-3xl pointer-events-none" />

      {/* Card */}
      <div className="relative z-10 w-full max-w-sm">
        <div className="bg-card rounded-2xl shadow-xl border border-border p-8">
          {/* Logo */}
          <div className="flex items-center justify-center gap-2 mb-8">
            <div className="p-2 bg-primary/10 rounded-xl">
              <RadarLogo className="h-6 w-6 text-primary" />
            </div>
            <span className="text-xl font-bold tracking-tight">PantryRadar</span>
          </div>

          {/* Heading */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">
              {isRegister ? "Create account" : "Welcome back"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isRegister ? "Get started with PantryRadar" : "Sign in to your household"}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              {isRegister && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                />
              </div>
              {error && (
                <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-xl text-sm border border-destructive/20">
                  {error instanceof Error ? error.message : "An error occurred"}
                </div>
              )}
              <Button type="submit" className="w-full mt-2 rounded-xl h-11" disabled={isLoading}>
                {isLoading ? "Loading..." : isRegister ? "Sign Up" : "Sign In"}
              </Button>
            </div>
          </form>
        </div>

        {/* Footer links */}
        <div className="relative z-10 mt-6 flex flex-col items-center gap-2">
          <button
            onClick={() => setIsRegister(!isRegister)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {isRegister ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
          </button>
          {!isRegister && (
            <button
              onClick={() => navigate("/join")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Join a household with invite code
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
