import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { Mail } from "lucide-react-native";
import { setAuthToken, setUser } from "../../src/lib/auth";
import { apiClient } from "../../src/lib/api";

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const handleSendMagicLink = async () => {
    if (!email.trim() || !email.includes("@")) {
      Alert.alert("Error", "Please enter a valid email address");
      return;
    }

    setLoading(true);

    try {
      // In a real implementation, this would call the Better Auth magic link endpoint
      // For now, we'll simulate a successful response
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setMagicLinkSent(true);
      Alert.alert(
        "Check Your Email",
        "We've sent you a magic link to sign in. Please check your email and click the link to continue.",
        [{ text: "OK" }]
      );
    } catch (error) {
      console.error("Failed to send magic link:", error);
      Alert.alert("Error", "Failed to send magic link. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-gray-50"
    >
      <ScrollView contentContainerClassName="flex-grow">
        <View className="flex-1 items-center justify-center p-6">
          <View className="w-full max-w-md">
            <View className="mb-8">
              <Text className="text-3xl font-bold text-gray-900 text-center mb-2">
                Welcome to PantryRadar
              </Text>
              <Text className="text-gray-600 text-center">
                Sign in to manage your household inventory
              </Text>
            </View>

            <View className="bg-white p-6 rounded-lg shadow-sm">
              {!magicLinkSent ? (
                <>
                  <View className="mb-4">
                    <Text className="text-sm text-gray-700 mb-2">Email</Text>
                    <View className="flex-row items-center border border-gray-300 rounded-lg px-3 py-2">
                      <Mail color="#6b7280" size={20} />
                      <TextInput
                        value={email}
                        onChangeText={setEmail}
                        placeholder="your@email.com"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoComplete="email"
                        className="flex-1 ml-2 text-base"
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    onPress={handleSendMagicLink}
                    disabled={loading}
                    className={`py-3 rounded-lg ${
                      loading ? "bg-blue-400" : "bg-blue-600"
                    }`}
                  >
                    <Text className="text-white font-semibold text-center text-base">
                      {loading ? "Sending..." : "Send Magic Link"}
                    </Text>
                  </TouchableOpacity>

                  <View className="flex-row items-center justify-center mt-6">
                    <View className="flex-1 h-px bg-gray-300" />
                    <Text className="text-gray-500 text-sm mx-4">OR</Text>
                    <View className="flex-1 h-px bg-gray-300" />
                  </View>

                  <View className="mt-6 gap-3">
                    <TouchableOpacity
                      onPress={() => router.push("/auth/register")}
                      className="py-3 rounded-lg border border-gray-300"
                    >
                      <Text className="text-gray-700 font-semibold text-center">
                        Create New Household
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => router.push("/auth/join")}
                      className="py-3 rounded-lg border border-gray-300"
                    >
                      <Text className="text-gray-700 font-semibold text-center">
                        Join Existing Household
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <View className="items-center py-4">
                  <Mail color="#2563eb" size={64} />
                  <Text className="text-lg font-semibold text-gray-900 mt-4 text-center">
                    Check your email
                  </Text>
                  <Text className="text-sm text-gray-600 mt-2 text-center">
                    We sent a magic link to {email}. Click the link to sign in.
                  </Text>
                  <TouchableOpacity
                    onPress={() => setMagicLinkSent(false)}
                    className="mt-6"
                  >
                    <Text className="text-blue-600 font-semibold">
                      Try a different email
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
