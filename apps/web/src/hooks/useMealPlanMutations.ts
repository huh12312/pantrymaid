import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type IngredientSource,
  type MealPlanDetail,
  type MealPlanIngredient,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

export interface MealPlanMutationCallbacks {
  onIngredientToggleError: (msg: string) => void;
  /** `skipped` defaults to 0 when the server response omits the field — see the
   * doc comment on `api.commitMealPlanShopping`. */
  onCommitSuccess: (created: number, skipped: number) => void;
  onCommitError: (msg: string) => void;
  onDeleteSuccess: () => void;
  onDeleteError: (msg: string) => void;
  onRegenerateMealError: (msg: string) => void;
}

function mapIngredients(
  plan: MealPlanDetail,
  mealId: string | null,
  ingredientId: string,
  patch: Partial<MealPlanIngredient>
): MealPlanDetail {
  return {
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => {
        if (mealId && meal.id !== mealId) return meal;
        return {
          ...meal,
          ingredients: meal.ingredients.map((ing) =>
            ing.id === ingredientId ? { ...ing, ...patch } : ing
          ),
        };
      }),
    })),
  };
}

function mapMealDetailStatus(
  plan: MealPlanDetail,
  mealId: string,
  patch: { detailStatus: "pending"; detailError: null }
): MealPlanDetail {
  return {
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => (meal.id === mealId ? { ...meal, ...patch } : meal)),
    })),
  };
}

/**
 * Mutations for the Meal Plan detail surface: flipping an ingredient between have/buy
 * (`source`), committing the buy list to the shopping list, deleting a plan, and
 * kicking off a single-meal regeneration. Mirrors the mutation/invalidation idiom in
 * `useInventoryMutations.ts` (optimistic cache write in `onMutate`, snapshot-based
 * rollback in `onError`).
 *
 * CRITICAL cache rule (plan §5.8): have/buy purchase status is never cached as its own
 * entity — it's computed at render from `mealPlan.detail x inventory.list x
 * shoppingList.lists`. So `commitShopping`'s success handler invalidates ONLY
 * `queryKeys.shoppingList.lists()`. It must never invalidate or refetch anything
 * meal-plan-scoped — there is nothing on the cached plan for a shopping-list commit to
 * have made stale (the ingredient rows' own `source` doesn't change; only a
 * `shopping_list_items` row gets created server-side).
 */
export function useMealPlanMutations(callbacks: MealPlanMutationCallbacks) {
  const queryClient = useQueryClient();

  const getCachedPlan = (planId: string) =>
    queryClient.getQueryData<MealPlanDetail>(queryKeys.mealPlan.detail(planId));

  const toggleIngredientSourceMutation = useMutation({
    mutationFn: ({
      planId,
      ingredientId,
      source,
    }: {
      planId: string;
      ingredientId: string;
      source: IngredientSource;
    }) => api.updateMealPlanIngredient(planId, ingredientId, { source }),
    onMutate: async ({ planId, ingredientId, source }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.mealPlan.detail(planId) });
      const previous = getCachedPlan(planId);
      if (previous) {
        queryClient.setQueryData<MealPlanDetail>(
          queryKeys.mealPlan.detail(planId),
          mapIngredients(previous, null, ingredientId, { source, sourceOverridden: true })
        );
      }
      return { previous, planId };
    },
    onSuccess: (updated, { planId, ingredientId }) => {
      const current = getCachedPlan(planId);
      if (current) {
        queryClient.setQueryData<MealPlanDetail>(
          queryKeys.mealPlan.detail(planId),
          mapIngredients(current, null, ingredientId, updated)
        );
      }
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.mealPlan.detail(context.planId), context.previous);
      }
      callbacks.onIngredientToggleError(
        error instanceof Error ? error.message : "Failed to update ingredient."
      );
    },
  });

  const commitShoppingMutation = useMutation({
    mutationFn: ({ planId, ingredientIds }: { planId: string; ingredientIds?: string[] }) =>
      api.commitMealPlanShopping(planId, ingredientIds ? { ingredientIds } : {}),
    onSuccess: (result) => {
      // See the CRITICAL cache rule above — shoppingList only, nothing meal-plan-scoped.
      void queryClient.invalidateQueries({ queryKey: queryKeys.shoppingList.lists() });
      // `skipped` is a field the server is adding concurrently — treat its absence as 0
      // rather than assuming it's always there (see api.commitMealPlanShopping's doc comment).
      callbacks.onCommitSuccess(result.created, result.skipped ?? 0);
    },
    onError: (error) => {
      callbacks.onCommitError(
        error instanceof Error ? error.message : "Failed to add items to the shopping list."
      );
    },
  });

  const deletePlanMutation = useMutation({
    mutationFn: (planId: string) => api.deleteMealPlan(planId),
    onSuccess: (_data, planId) => {
      queryClient.removeQueries({ queryKey: queryKeys.mealPlan.detail(planId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.mealPlan.lists() });
      callbacks.onDeleteSuccess();
    },
    onError: (error) => {
      callbacks.onDeleteError(
        error instanceof Error ? error.message : "Failed to delete meal plan."
      );
    },
  });

  const regenerateMealMutation = useMutation({
    mutationFn: ({ planId, mealId }: { planId: string; mealId: string }) =>
      api.regenerateMeal(planId, mealId),
    onMutate: async ({ planId, mealId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.mealPlan.detail(planId) });
      const previous = getCachedPlan(planId);
      if (previous) {
        queryClient.setQueryData<MealPlanDetail>(
          queryKeys.mealPlan.detail(planId),
          mapMealDetailStatus(previous, mealId, { detailStatus: "pending", detailError: null })
        );
      }
      return { previous, planId };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.mealPlan.detail(context.planId), context.previous);
      }
      callbacks.onRegenerateMealError(
        error instanceof Error ? error.message : "Failed to regenerate this meal."
      );
    },
    onSettled: (_data, _error, { planId }) => {
      // The regeneration itself runs async server-side (202). Refetch once so a caller
      // polling via `useMealPlanGeneration`'s `planNeedsPolling` (which also watches for
      // `detailStatus === "pending"`) picks up the freshest state right away rather than
      // waiting for the next 2s tick.
      void queryClient.invalidateQueries({ queryKey: queryKeys.mealPlan.detail(planId) });
    },
  });

  const toggleIngredientSource = (
    planId: string,
    ingredientId: string,
    source: IngredientSource
  ) => {
    toggleIngredientSourceMutation.mutate({ planId, ingredientId, source });
  };

  const commitShopping = (planId: string, ingredientIds?: string[]) => {
    commitShoppingMutation.mutate({ planId, ingredientIds });
  };

  const deletePlan = (planId: string) => {
    deletePlanMutation.mutate(planId);
  };

  const regenerateMeal = (planId: string, mealId: string) => {
    regenerateMealMutation.mutate({ planId, mealId });
  };

  return {
    toggleIngredientSourceMutation,
    commitShoppingMutation,
    deletePlanMutation,
    regenerateMealMutation,
    toggleIngredientSource,
    commitShopping,
    deletePlan,
    regenerateMeal,
  };
}
