import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import PlannerPage from "@/pages/planner";
import { ChartPreferencesProvider } from "@/components/ChartPreferences";

function AppRouter() {
  return (
    <PlannerPage />
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <ChartPreferencesProvider><AppRouter /></ChartPreferencesProvider>
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
