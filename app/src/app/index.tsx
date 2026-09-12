
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Alert,
} from "react-native";

export default function HomeScreen() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [search, setSearch] = useState("");
  const [showSellForm, setShowSellForm] = useState(false);
  const [itemTitle, setItemTitle] = useState("");

  if (!loggedIn) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.loginContainer}>
          <Text style={styles.logo}>UC MARKET</Text>

          <Text style={styles.tagline}>
            Buy. Sell. Connect.
          </Text>

          <Text style={styles.title}>
            {isSignUp ? "Create your account" : "Welcome back"}
          </Text>

          <Text style={styles.subtitle}>
            {isSignUp
              ? "Join the student marketplace."
              : "Sign in to continue to UC Market."}
          </Text>

          {isSignUp && (
            <TextInput
              style={styles.input}
              placeholder="Full name"
              value={name}
              onChangeText={setName}
            />
          )}

          <TextInput
            style={styles.input}
            placeholder="University email"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => {
              if (!email || !password || (isSignUp && !name)) {
                Alert.alert("Missing information", "Please fill everything in.");
                return;
              }

              setLoggedIn(true);
            }}
          >
            <Text style={styles.primaryButtonText}>
              {isSignUp ? "Create account" : "Sign in"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setIsSignUp(!isSignUp)}
          >
            <Text style={styles.switchText}>
              {isSignUp
                ? "Already have an account? Sign in"
                : "Don't have an account? Create one"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const listings = [
    {
      title: "Mini Fridge",
      category: "Electronics",
      seller: "Alex",
      price: "$50",
      emoji: "🧊",
    },
    {
      title: "Calculus Textbook",
      category: "Textbooks",
      seller: "Jordan",
      price: "$25",
      emoji: "📚",
    },
    {
      title: "Desk Lamp",
      category: "Furniture",
      seller: "Mike",
      price: "$15",
      emoji: "💡",
    },
    {
      title: "Nike Hoodie",
      category: "Clothing",
      seller: "Chris",
      price: "$30",
      emoji: "👕",
    },
    {
      title: "Homemade Cookies",
      category: "Food",
      seller: "Sam",
      price: "$8",
      emoji: "🍪",
    },
  ];

  const categories = [
    "All",
    "Textbooks",
    "Electronics",
    "Furniture",
    "Clothing",
    "Food",
    "Services",
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <View style={styles.header}>
          <Text style={styles.logoSmall}>UC MARKET</Text>

          <TouchableOpacity onPress={() => setLoggedIn(false)}>
            <Text style={styles.logout}>Log out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroTitle}>
            Buy. Sell. Connect.
          </Text>

          <Text style={styles.heroSubtitle}>
            Find what you need from students around campus.
          </Text>

          <TextInput
            style={styles.search}
            placeholder="🔎  Search items, food, services..."
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <Text style={styles.sectionTitle}>Categories</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryRow}
        >
          {categories.map((category) => (
            <TouchableOpacity
              key={category}
              style={[
                styles.category,
                category === "All" && styles.categoryActive,
              ]}
            >
              <Text
                style={[
                  styles.categoryText,
                  category === "All" && styles.categoryTextActive,
                ]}
              >
                {category}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.sectionTitle}>Latest listings</Text>

        <View style={styles.list}>
          {listings
            .filter((item) =>
              item.title.toLowerCase().includes(search.toLowerCase())
            )
            .map((item) => (
              <TouchableOpacity
                key={item.title}
                style={styles.card}
                onPress={() =>
                  Alert.alert(
                    item.title,
                    `${item.price}\nSold by ${item.seller}\nCategory: ${item.category}`
                  )
                }
              >
                <View style={styles.iconBox}>
                  <Text style={styles.emoji}>{item.emoji}</Text>
                </View>

                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardCategory}>
                    {item.category}
                  </Text>
                  <Text style={styles.seller}>
                    Sold by {item.seller}
                  </Text>
                </View>

                <Text style={styles.price}>{item.price}</Text>
              </TouchableOpacity>
            ))}
        </View>

        <TouchableOpacity
          style={styles.sellButton}
          onPress={() => setShowSellForm(true)}
        >
          <Text style={styles.sellButtonText}>
            + Sell something
          </Text>
        </TouchableOpacity>
        {showSellForm && (
  <View style={{ padding: 20 }}>
    <Text>Sell an item</Text>
    <TextInput
  placeholder="What are you selling?"
  style={styles.search}
  value={itemTitle}
  onChangeText={setItemTitle}
/>
<TouchableOpacity
  style={styles.sellButton}
onPress={() => alert("Your item was listed!")}
>
  <Text style={styles.sellButtonText}>Publish listing</Text>
</TouchableOpacity>
  </View>
)}

        <Text style={styles.footer}>
          UC Market • Made for students
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F5EF",
  },

  loginContainer: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 30,
  },

  logo: {
    fontSize: 38,
    fontWeight: "800",
    color: "#7A1530",
    textAlign: "center",
  },

  tagline: {
    textAlign: "center",
    color: "#777",
    fontSize: 16,
    marginTop: 8,
    marginBottom: 55,
  },

  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#222",
    marginBottom: 8,
  },

  subtitle: {
    color: "#777",
    marginBottom: 25,
    fontSize: 15,
  },

  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
    marginBottom: 14,
    fontSize: 16,
  },

  primaryButton: {
    backgroundColor: "#7A1530",
    height: 54,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },

  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },

  switchText: {
    textAlign: "center",
    color: "#7A1530",
    marginTop: 22,
    fontWeight: "600",
  },

  header: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  logoSmall: {
    fontSize: 22,
    fontWeight: "800",
    color: "#7A1530",
  },

  logout: {
    color: "#7A1530",
    fontWeight: "600",
  },

  hero: {
    padding: 24,
  },

  heroTitle: {
    fontSize: 34,
    fontWeight: "800",
    color: "#222",
  },

  heroSubtitle: {
    fontSize: 16,
    color: "#777",
    marginTop: 8,
    marginBottom: 22,
  },

  search: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    height: 52,
    paddingHorizontal: 18,
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#E1DDD5",
  },

  sectionTitle: {
    fontSize: 21,
    fontWeight: "700",
    color: "#222",
    marginHorizontal: 24,
    marginTop: 8,
    marginBottom: 14,
  },

  categoryRow: {
    paddingHorizontal: 24,
    gap: 10,
    paddingBottom: 20,
  },

  category: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#DDD",
  },

  categoryActive: {
    backgroundColor: "#7A1530",
    borderColor: "#7A1530",
  },

  categoryText: {
    color: "#555",
    fontWeight: "600",
  },

  categoryTextActive: {
    color: "#FFFFFF",
  },

  list: {
    paddingHorizontal: 24,
  },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 15,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E6E2DB",
  },

  iconBox: {
    width: 58,
    height: 58,
    borderRadius: 12,
    backgroundColor: "#F1EEE7",
    alignItems: "center",
    justifyContent: "center",
  },

  emoji: {
    fontSize: 28,
  },

  cardInfo: {
    flex: 1,
    marginLeft: 14,
  },

  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#222",
  },

  cardCategory: {
    fontSize: 13,
    color: "#777",
    marginTop: 3,
  },

  seller: {
    fontSize: 12,
    color: "#999",
    marginTop: 4,
  },

  price: {
    fontSize: 17,
    fontWeight: "800",
    color: "#7A1530",
  },

  sellButton: {
    marginHorizontal: 24,
    marginTop: 15,
    height: 54,
    borderRadius: 14,
    backgroundColor: "#7A1530",
    alignItems: "center",
    justifyContent: "center",
  },

  sellButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },

  footer: {
    textAlign: "center",
    color: "#999",
    marginTop: 30,
    marginBottom: 30,
    fontSize: 12,
  },
});