import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import PlannerPage from "@/pages/planner";
import { ChartPreferencesProvider } from "@/components/ChartPreferences";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={PlannerPage} />
      <Route component={NotFound} />
    </Switch>
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
