
import React, { useEffect, useState } from "react";
import {
  View,
Image,
  Text,
  TextInput,
  Pressable,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Alert,
  Modal,
  ActivityIndicator,
  useWindowDimensions,
  Linking,
  Platform,
} from "react-native";
import type { User } from "@supabase/supabase-js";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";

type Listing = {
  id?: string | number;
  title: string;
  description?: string | null;
  category: string;
  seller?: string | null;
  seller_id?: string | null;
  price: string;
  image?: string | null;
  image_url?: string | null;
  images?: string[] | null;
  status?: "Available" | "Pending" | "Sold" | string | null;
  created_at?: string;
  removed_at?: string | null;
  emoji?: string;
  seller_profile?: Profile | Profile[] | null;
};

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role?: "student" | "staff" | "admin";
};

type Conversation = {
  id: string;
  listing_id: number;
  buyer_id: string;
  seller_id: string;
  listing?: Listing | null;
  other_profile?: Profile | Profile[] | null;
};

type Message = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type Purchase = {
  id: string;
  listing_id: number;
  buyer_id: string;
  seller_id: string;
  price: string;
  status: "pending" | "accepted" | "declined" | "cancelled" | "cash_pending" | "completed" | string;
  payment_method?: "online" | "cash";
  stripe_checkout_session_id?: string | null;
  created_at: string;
  listing?: Listing | null;
};

type ConversationPreview = Conversation & {
  latest_message?: Message | null;
};

const listingImageUrl = (value?: string | null) => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const path = value.replace(/^\/+/, "").replace(/^listing-images\//, "");
  return `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/listing-images/${path}`;
};

const listingImages = (listing: Listing) => {
  const values = Array.isArray(listing.images) ? listing.images : [];
  return Array.from(new Set([...(values ?? []), listing.image_url, listing.image].filter(Boolean) as string[]));
};

const getProfile = (listing: Listing) =>
  Array.isArray(listing.seller_profile) ? listing.seller_profile[0] : listing.seller_profile;

const sellerName = (listing: Listing) =>
  getProfile(listing)?.full_name?.trim() ||
  getProfile(listing)?.email ||
  (listing.seller && listing.seller !== "You" ? listing.seller : null) ||
  "Seller unavailable";

const purchaseStatusLabel = (purchase: Purchase) => {
  if (purchase.status === "pending") return "Requested";
  if (purchase.status === "accepted") return "Accepted / Reserved — payment required";
  if (purchase.status === "cash_pending") return "Awaiting in-person completion";
  if (purchase.status === "completed") {
    return purchase.payment_method === "cash" ? "Paid in person / Sold" : "Paid / Sold";
  }
  if (purchase.status === "declined") return "Declined";
  if (purchase.status === "cancelled") return "Cancelled";
  return purchase.status;
};

type PatriotCharacterProps = {
  className: "seller" | "handshake" | "package";
  position: "Seller" | "HandshakeLeft" | "HandshakeRight" | "Package" | "MobileHandshakeLeft" | "MobileHandshakeRight";
};

const PatriotCharacter = ({ className, position }: PatriotCharacterProps) => (
  <View style={[styles.heroPatriot, styles[`heroPatriot${position}`]]}>
    <View style={styles.heroPatriotShadow} />
    <View style={styles.heroPatriotHat}>
      <View style={styles.heroPatriotHatCrown} />
      <View style={styles.heroPatriotHatBrim} />
      <View style={styles.heroPatriotFeather} />
    </View>
    <View style={styles.heroPatriotHead}>
      <View style={styles.heroPatriotHair} />
      <View style={styles.heroPatriotBrow} />
      <View style={styles.heroPatriotEyeLeft} />
      <View style={styles.heroPatriotEyeRight} />
      <View style={styles.heroPatriotNose} />
      <View style={styles.heroPatriotChin} />
      <View style={styles.heroPatriotSmile} />
    </View>
    <View style={styles.heroPatriotTorso}>
      <View style={styles.heroPatriotCollar} />
      <View style={styles.heroPatriotVest} />
      <View style={styles.heroPatriotButton} />
      <View style={styles.heroPatriotButtonLower} />
    </View>
    <View style={[styles.heroPatriotArm, styles.heroPatriotArmLeft, className === "handshake" && styles.heroPatriotArmExtended]} />
    <View style={[styles.heroPatriotArm, styles.heroPatriotArmRight, className === "handshake" && styles.heroPatriotArmExtendedRight]} />
    {className === "package" ? <View style={styles.heroPatriotPackageItem}><Text style={styles.heroPackageMark}>UC</Text></View> : null}
    <View style={styles.heroPatriotLegLeft} />
    <View style={styles.heroPatriotLegRight} />
    <View style={styles.heroPatriotBootLeft} />
    <View style={styles.heroPatriotBootRight} />
  </View>
);

const fetchListingsWithProfiles = async (includeRemoved = false): Promise<Listing[]> => {
  let listingQuery = supabase
    .from("listings")
    .select("*")
    .order("created_at", { ascending: false });
  if (!includeRemoved) listingQuery = listingQuery.is("removed_at", null);
  const { data: listingData, error: listingsError } = await listingQuery;
  if (listingsError) throw listingsError;

  const listings = (listingData ?? []) as Listing[];
  const sellerIds = Array.from(
    new Set(listings.map((listing) => listing.seller_id).filter((sellerId): sellerId is string => Boolean(sellerId))),
  );
  if (!sellerIds.length) return listings;

  const { data: profileData, error: profilesError } = await supabase
    .from("profiles")
    .select("id,full_name,email,avatar_url")
    .in("id", sellerIds);
  if (profilesError) throw profilesError;

  const profilesById = new Map((profileData ?? []).map((profile) => [profile.id, profile as Profile]));
  return listings.map((listing) => ({
    ...listing,
    seller_profile: listing.seller_id ? profilesById.get(listing.seller_id) ?? null : null,
  }));
};

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const isMobileHero = width < 600;
  const [loggedIn, setLoggedIn] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isSignUp, setIsSignUp] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const [search, setSearch] = useState("");
  const [showSellForm, setShowSellForm] = useState(false);
  const [itemTitle, setItemTitle] = useState("");
const [itemPrice, setItemPrice] = useState("");
 const [itemDescription, setItemDescription] = useState("");
const [itemImage, setItemImage] = useState("");
 const [itemFiles, setItemFiles] = useState<ImagePicker.ImagePickerAsset[]>([]);
const [itemCategory, setItemCategory] = useState("Electronics");
const [publishLoading, setPublishLoading] = useState(false);
const [publishError, setPublishError] = useState("");
const [listings, setListings] = useState<Listing[]>([]);
 const [favorites, setFavorites] = useState<Set<string>>(new Set());
 const [favoriteLoadingIds, setFavoriteLoadingIds] = useState<Set<string>>(new Set());
 const [listingStatus, setListingStatus] = useState("Available");
 const [category, setCategory] = useState("All");
 const [availability, setAvailability] = useState("All");
 const [sortOrder, setSortOrder] = useState("newest");
 const [showCategoryMenu, setShowCategoryMenu] = useState(false);
const [showFilterMenu, setShowFilterMenu] = useState(false);
const [marketSection, setMarketSection] = useState<
  "chat" | "favorites" | "purchases" | "sales" | "messages" | "staff"
>("favorites");

 const [loadingListings, setLoadingListings] = useState(false);
 const [listingError, setListingError] = useState("");
 const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
 const [activeDetailImage, setActiveDetailImage] = useState<string | null>(null);
 const [showEditListing, setShowEditListing] = useState(false);
 const [deleteTarget, setDeleteTarget] = useState<Listing | null>(null);
 const [deleteLoading, setDeleteLoading] = useState(false);
 const [editTitle, setEditTitle] = useState("");
 const [editPrice, setEditPrice] = useState("");
 const [editDescription, setEditDescription] = useState("");
 const [editCategory, setEditCategory] = useState("Electronics");
 const [editStatus, setEditStatus] = useState<"Available" | "Pending" | "Reserved" | "Sold">("Available");
 const [editFiles, setEditFiles] = useState<ImagePicker.ImagePickerAsset[]>([]);
 const [editLoading, setEditLoading] = useState(false);
 const [conversation, setConversation] = useState<Conversation | null>(null);
 const [conversations, setConversations] = useState<Conversation[]>([]);
 const [messages, setMessages] = useState<Message[]>([]);
 const [messageText, setMessageText] = useState("");
 const [chatLoading, setChatLoading] = useState(false);
 const [messageSending, setMessageSending] = useState(false);
 const [purchaseLoading, setPurchaseLoading] = useState(false);
 const [purchaseError, setPurchaseError] = useState("");
 const [purchaseRequestIds, setPurchaseRequestIds] = useState<Set<string>>(new Set());
 const [showConversations, setShowConversations] = useState(false);
 const [purchases, setPurchases] = useState<Purchase[]>([]);
 const [incomingPurchases, setIncomingPurchases] = useState<Purchase[]>([]);
 const [showMyMarket, setShowMyMarket] = useState(false);
 const [myMarketLoading, setMyMarketLoading] = useState(false);
 const [myMarketError, setMyMarketError] = useState("");
 const [marketConversations, setMarketConversations] = useState<ConversationPreview[]>([]);
 const [purchaseActionLoading, setPurchaseActionLoading] = useState<string | null>(null);
 const [adminListings, setAdminListings] = useState<Listing[]>([]);
 const [moderationTarget, setModerationTarget] = useState<Listing | null>(null);
 const [moderationLoading, setModerationLoading] = useState(false);
 const [stripeStatus, setStripeStatus] = useState<"unknown" | "setup_required" | "setup_incomplete" | "connected">("unknown");
useEffect(() => {
  supabase.auth.getSession().then(({ data }) => {
    setAuthUser(data.session?.user ?? null);
    setLoggedIn(Boolean(data.session?.user));
  });
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    setAuthUser(session?.user ?? null);
    setLoggedIn(Boolean(session?.user));
  });
  return () => data.subscription.unsubscribe();
}, []);
useEffect(() => {
  if (!authUser) return;
  const ensureProfileAndLoad = async () => {
    const { data: existingProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id,full_name,email,avatar_url,role")
      .eq("id", authUser.id)
      .maybeSingle();
    if (!profileError && !existingProfile) {
      await supabase.from("profiles").upsert({
        id: authUser.id,
        full_name: authUser.user_metadata.full_name || null,
        email: authUser.email || null,
        avatar_url: null,
        role: "student",
      });
    }
    const { data: currentProfile } = await supabase
      .from("profiles")
      .select("id,full_name,email,avatar_url,role")
      .eq("id", authUser.id)
      .maybeSingle();
    setProfile((currentProfile as Profile | null) ?? null);
    setLoadingListings(true);
    setListingError("");
    try {
      setListings(await fetchListingsWithProfiles());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load listings.";
      setListingError(message);
      Alert.alert("Unable to load listings", message);
      setLoadingListings(false);
      return;
    }
    const { data: favoriteRows, error: favoriteError } = await supabase.from("favorites").select("listing_id").eq("user_id", authUser.id);
    if (favoriteError) {
      console.error("Favorite loading failed:", {
        code: favoriteError.code,
        message: favoriteError.message,
        details: favoriteError.details,
        hint: favoriteError.hint,
        status: (favoriteError as { status?: number }).status,
        statusCode: (favoriteError as { statusCode?: number }).statusCode,
        authUserExists: Boolean(authUser),
        authUserId: authUser.id,
      });
      Alert.alert("Unable to load favorites", "Your favorites could not be loaded. Please try again.");
    }
    else setFavorites(new Set((favoriteRows ?? []).map((row) => String(row.listing_id))));
    const { data: purchaseRows, error: purchaseError } = await supabase
      .from("purchases")
      .select("listing_id,status")
      .eq("buyer_id", authUser.id)
      .in("status", ["pending", "accepted"]);
    if (purchaseError) {
      Alert.alert("Unable to load purchase requests", purchaseError.message);
    } else {
      setPurchaseRequestIds(new Set((purchaseRows ?? []).map((row) => String(row.listing_id))));
    }
    const { data: purchaseData, error: purchaseListError } = await supabase
      .from("purchases")
      .select("*, listing:listings(*)")
      .or(`buyer_id.eq.${authUser.id},seller_id.eq.${authUser.id}`)
      .order("created_at", { ascending: false });
    if (purchaseListError) {
      Alert.alert("Unable to load purchase history", purchaseListError.message);
    } else {
      const userPurchases = (purchaseData ?? []) as Purchase[];
      setPurchases(userPurchases.filter((purchase) => purchase.buyer_id === authUser.id));
      setIncomingPurchases(userPurchases.filter((purchase) => purchase.seller_id === authUser.id));
    }
    setLoadingListings(false);
  };
  void ensureProfileAndLoad();
}, [authUser]);

useEffect(() => {
  let active = true;
  const showCheckoutReturnMessage = (url: string | null) => {
    if (!url) return;
    const paymentStatus = new URL(url).searchParams.get("payment");
    if (paymentStatus === "success") {
      Alert.alert("Payment processing", "Stripe is confirming your payment. Your purchase will show as paid after server verification.");
    } else if (paymentStatus === "cancelled") {
      Alert.alert("Checkout cancelled", "No payment was confirmed. Your reservation remains in My Purchases while the Checkout session is active.");
    }
  };

  void Linking.getInitialURL().then((url) => {
    if (active) showCheckoutReturnMessage(url);
  });
  const subscription = Linking.addEventListener("url", ({ url }) => showCheckoutReturnMessage(url));
  return () => {
    active = false;
    subscription.remove();
  };
}, []);

useEffect(() => {
  if (!authUser) return;
  void supabase
    .from("conversations")
    .select("*, listing:listings(*)")
    .or(`buyer_id.eq.${authUser.id},seller_id.eq.${authUser.id}`)
    .order("created_at", { ascending: false })
    .then(({ data, error }) => {
      if (error) Alert.alert("Unable to load messages", error.message);
      else setConversations((data ?? []) as Conversation[]);
    });
}, [authUser, conversation]);

    useEffect(() => {
    if (!authUser || !conversation) return;

    const channel = supabase
      .channel(`conversation-messages:${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;

          setMessages((current) => {
            if (current.some((message) => message.id === newMessage.id)) {
              return current;
            }

            return [...current, newMessage];
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [authUser, conversation]);
const toggleFavorite = async (listing: Listing) => {
    if (!authUser || listing.id == null) {
      Alert.alert("Sign in required", "Sign in to save favorites.");
      return;
    }
    if (listing.seller_id === authUser.id) {
      Alert.alert("Your listing", "You cannot save your own listing as a favorite.");
      return;
    }
    const key = String(listing.id);
    if (favoriteLoadingIds.has(key)) return;
    const isFavorite = favorites.has(key);
    setFavoriteLoadingIds((current) => new Set(current).add(key));
    try {
      const result = isFavorite
        ? await supabase.from("favorites").delete().eq("user_id", authUser.id).eq("listing_id", listing.id)
        : await supabase.from("favorites").insert({ user_id: authUser.id, listing_id: listing.id });
      if (result.error) {
        console.error("Favorite update failed:", result.error);
        const message = result.error.code === "42501"
          ? "You do not have permission to update this favorite. Please sign in again."
          : "Your favorite could not be updated. Please try again.";
        Alert.alert("Unable to update favorite", message);
        return;
      }
      setFavorites((current) => {
        const next = new Set(current);
        if (isFavorite) next.delete(key); else next.add(key);
        return next;
      });
    } finally {
      setFavoriteLoadingIds((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };


  const payForPurchase = async (purchase: Purchase) => {
    if (!authUser || purchase.buyer_id !== authUser.id || purchase.status !== "accepted") return;

    try {
      setPurchaseActionLoading(purchase.id);

      const { data, error } = await supabase.functions.invoke(
        "create-checkout-session",
        {
          body: { purchaseId: purchase.id },
        },
      );

      if (error) throw error;

      if (!data?.url) {
        throw new Error(
          data?.error || "Checkout URL was not returned.",
        );
      }

      if (data.sessionId) {
        const updateSession = (current: Purchase[]) => current.map((item) =>
          item.id === purchase.id ? { ...item, stripe_checkout_session_id: data.sessionId } : item
        );
        setPurchases(updateSession);
      }
      await Linking.openURL(data.url);
    } catch (error) {
      Alert.alert(
        "Payment failed",
        error instanceof Error
          ? error.message
          : "Unable to start payment.",
      );
    } finally {
      setPurchaseActionLoading(null);
    }
  };

  const requestPurchase = async (listing: Listing) => {
    if (purchaseLoading) return;
    setPurchaseError("");
    if (!authUser) {
      Alert.alert("Sign in required", "Sign in to request a purchase.");
      return;
    }
    if (listing.id == null || !listing.seller_id) {
      Alert.alert("Purchase unavailable", "This listing does not have a valid seller.");
      return;
    }
    if (listing.seller_id === authUser.id) {
      Alert.alert("This is your listing", "You cannot purchase your own listing.");
      return;
    }
    if ((listing.status ?? "Available") !== "Available") {
      Alert.alert("Purchase unavailable", "This listing is no longer available.");
      return;
    }

    const listingKey = String(listing.id);

    setPurchaseLoading(true);
    try {
      const { data: existingRows, error: existingError } = await supabase
        .from("purchases")
        .select("id")
        .eq("listing_id", listing.id)
        .eq("buyer_id", authUser.id)
        .in("status", ["pending", "accepted"])
        .limit(1);
      if (existingError) throw existingError;
      if (existingRows?.length) {
        setPurchaseRequestIds((current) => new Set(current).add(listingKey));
        await refreshMyPurchases(authUser.id);
        return;
      }

      const { data: createdPurchase, error: insertError } = await supabase.from("purchases").insert({
        listing_id: listing.id,
        buyer_id: authUser.id,
        seller_id: listing.seller_id,
        price: listing.price,
        status: "pending",
        payment_method: "online",
      }).select("*, listing:listings(*)").single();
      if (insertError) {
        if (insertError.code === "23505") {
          setPurchaseRequestIds((current) => new Set(current).add(listingKey));
          await refreshMyPurchases(authUser.id);
          return;
        }
        throw insertError;
      }

      setPurchaseRequestIds((current) => new Set(current).add(listingKey));
      if (createdPurchase) {
        setPurchases((current) => [createdPurchase as Purchase, ...current]);
      }
      await refreshMyPurchases(authUser.id);
      Alert.alert("Purchase request sent", "Purchase request sent — waiting for the seller to accept.");
    } catch (error) {
      console.error("Unable to send purchase request", {
        code: typeof error === "object" && error !== null && "code" in error ? error.code : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
      setPurchaseError("Unable to send your purchase request. Please try again.");
      Alert.alert("Unable to send purchase request", "Please try again.");
    } finally {
      setPurchaseLoading(false);
    }
  };

  const chooseImages = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photo permission needed", "Allow photo access to add listing images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) setItemFiles(result.assets);
  };

  const chooseProfilePhoto = async () => {
    if (!authUser) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photo permission needed", "Allow photo access to add a profile photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;

    try {
      const asset = result.assets[0];
      const extension = asset.fileName?.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${authUser.id}/profile-${Date.now()}.${extension}`;
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const { error: uploadError } = await supabase.storage.from("listing-images").upload(path, blob, {
        contentType: asset.mimeType || "image/jpeg",
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from("listing-images").getPublicUrl(path);
      const avatarUrl = publicUrlData.publicUrl;
      const { data: updatedProfile, error: profileError } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
        .eq("id", authUser.id)
        .select("id,full_name,email,avatar_url,role")
        .single();
      if (profileError) throw profileError;
      setProfile(updatedProfile as Profile);
      setListings(await fetchListingsWithProfiles());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update your profile photo.";
      Alert.alert("Unable to update profile photo", message);
    }
  };

  const updateListingStatus = async (listing: Listing, status: "Available" | "Pending" | "Sold") => {
    const { error } = await supabase.from("listings").update({ status }).eq("id", listing.id).eq("seller_id", authUser?.id);
    if (error) {
      Alert.alert("Unable to update status", error.message);
      return;
    }
    setListings((current) => current.map((item) => item.id === listing.id ? { ...item, status } : item));
    setSelectedListing((current) => current && current.id === listing.id ? { ...current, status } : current);
  };

  const openListingDetails = (listing: Listing) => {
    setSelectedListing(listing);
    setActiveDetailImage(listingImages(listing)[0] ?? null);
  };

  const openEditListing = (listing: Listing) => {
    if (!authUser || listing.seller_id !== authUser.id) {
      Alert.alert("Unable to edit listing", "You can only edit your own listings.");
      return;
    }
    setEditTitle(listing.title);
    setEditPrice(listing.price.replace(/^\$/, ""));
    setEditDescription(listing.description ?? "");
    setEditCategory(listing.category);
    setEditStatus((listing.status === "Pending" || listing.status === "Reserved" || listing.status === "Sold" ? listing.status : "Available"));
    setEditFiles([]);
    setShowEditListing(true);
  };

  const chooseEditImages = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photo permission needed", "Allow photo access to add listing images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) setEditFiles(result.assets);
  };

  const uploadEditImages = async (userId: string) => {
    const paths: string[] = [];
    for (const [index, asset] of editFiles.entries()) {
      const extension = asset.fileName?.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${userId}/${Date.now()}-edit-${index}.${extension}`;
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const { error } = await supabase.storage.from("listing-images").upload(path, blob, {
        contentType: asset.mimeType || "image/jpeg",
        upsert: false,
      });
      if (error) throw error;
      paths.push(path);
    }
    return paths;
  };

  const saveEditedListing = async () => {
    if (editLoading || !selectedListing) return;
    if (!editTitle.trim() || !editPrice.trim()) {
      Alert.alert("Missing information", "Enter a title and price before saving.");
      return;
    }
    setEditLoading(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user || selectedListing.seller_id !== userData.user.id) {
        throw new Error("You can only edit your own listing.");
      }
      const newImagePaths = await uploadEditImages(userData.user.id);
      const existingImages = listingImages(selectedListing);
      const imageValues = newImagePaths.length ? [...existingImages, ...newImagePaths] : existingImages;
      const { data: updatedListing, error: updateError } = await supabase
        .from("listings")
        .update({
          title: editTitle.trim(),
          price: "$" + editPrice.trim().replace(/^\$/, ""),
          description: editDescription.trim(),
          category: editCategory,
          status: editStatus,
          image: imageValues[0] || null,
          image_url: imageValues[0] || null,
          images: imageValues,
        })
        .eq("id", selectedListing.id)
        .eq("seller_id", userData.user.id)
        .select("*")
        .single();
      if (updateError) throw updateError;

      const refreshedListings = await fetchListingsWithProfiles();
      setListings(refreshedListings);
      const refreshedListing = refreshedListings.find((listing) => listing.id === selectedListing.id) ?? updatedListing as Listing;
      setSelectedListing(refreshedListing);
      setActiveDetailImage(listingImages(refreshedListing)[0] ?? null);
      setShowEditListing(false);
      setEditFiles([]);
      Alert.alert("Listing updated", "Your listing changes were saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save listing changes.";
      Alert.alert("Unable to save listing", message);
    } finally {
      setEditLoading(false);
    }
  };

  const confirmDeleteListing = async () => {
    const listing = deleteTarget;
    if (!listing || deleteLoading) return;
    setDeleteLoading(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user || listing.seller_id !== userData.user.id) {
        throw new Error("You can only delete your own listing.");
      }
      const { data: relatedPurchases, error: purchaseError } = await supabase
        .from("purchases")
        .select("id")
        .eq("listing_id", listing.id);
      if (purchaseError) throw purchaseError;
      if (relatedPurchases?.length) {
        Alert.alert("Listing cannot be deleted", "This listing has purchase history. Keep it and change its status instead.");
        setDeleteTarget(null);
        return;
      }
      const { error: deleteError } = await supabase
        .from("listings")
        .delete()
        .eq("id", listing.id)
        .eq("seller_id", userData.user.id);
      if (deleteError) throw deleteError;

      const storagePaths = listingImages(listing)
        .map((value) => value.replace(/^https?:\/\/[^/]+\/storage\/v1\/object\/public\/listing-images\//, "").replace(/^listing-images\//, "").replace(/^\/+/, ""))
        .filter((value) => value.startsWith(`${userData.user.id}/`));
      if (storagePaths.length) {
        const { error: storageError } = await supabase.storage.from("listing-images").remove(storagePaths);
        if (storageError) Alert.alert("Listing deleted", `The listing was deleted, but some images could not be removed: ${storageError.message}`);
      }
      setListings((current) => current.filter((item) => item.id !== listing.id));
      setSelectedListing(null);
      setDeleteTarget(null);
      Alert.alert("Listing deleted", "Your listing was removed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete listing.";
      Alert.alert("Unable to delete listing", message);
    } finally {
      setDeleteLoading(false);
    }
  };

  const updatePurchaseStatus = async (purchase: Purchase, status: "accepted" | "declined") => {
    if (!authUser || purchase.seller_id !== authUser.id) {
      Alert.alert("Not authorized", "Only the listing owner can update this request.");
      return;
    }
    setPurchaseActionLoading(purchase.id);
    try {
      const { error } = await supabase.rpc("respond_to_purchase_request", {
        p_purchase_id: purchase.id,
        p_decision: status,
      });
      if (error) throw error;
      const updatePurchase = (current: Purchase[]) => current.map((item) => item.id === purchase.id ? { ...item, status } : item);
      setIncomingPurchases(updatePurchase);
      setPurchases(updatePurchase);
      if (status === "accepted" && purchase.listing) {
        setListings((current) => current.map((listing) => listing.id === purchase.listing_id ? { ...listing, status: "Reserved" } : listing));
      }
      await refreshMyPurchases(authUser.id);
      await refreshListings();
      Alert.alert(
        status === "accepted" ? "Purchase accepted" : "Purchase declined",
        status === "accepted"
          ? "The item is reserved for this buyer. They can now choose secure online payment or pay in person."
          : "The request was declined and the listing remains available.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update purchase request.";
      Alert.alert("Unable to update purchase request", message);
    } finally {
      setPurchaseActionLoading(null);
    }
  };

  const chooseCashPurchase = async (purchase: Purchase) => {
    if (!authUser || purchase.buyer_id !== authUser.id || purchase.status !== "accepted") return;
    setPurchaseActionLoading(purchase.id);
    try {
      const { error } = await supabase.rpc("begin_cash_purchase", {
        p_purchase_id: purchase.id,
      });
      if (error) throw error;
      await refreshMyPurchases(authUser.id);
      await refreshListings();
    } catch (error) {
      Alert.alert(
        "Unable to choose in-person payment",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setPurchaseActionLoading(null);
    }
  };

  const confirmCashPurchase = async (purchase: Purchase) => {
    if (!authUser || purchase.seller_id !== authUser.id || purchase.status !== "cash_pending") return;
    setPurchaseActionLoading(purchase.id);
    try {
      const { error } = await supabase.rpc("confirm_cash_purchase", {
        p_purchase_id: purchase.id,
      });
      if (error) throw error;
      await refreshMyPurchases(authUser.id);
      await refreshListings();
    } catch (error) {
      Alert.alert(
        "Unable to confirm in-person payment",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setPurchaseActionLoading(null);
    }
  };

  const cancelPurchaseRequest = async (purchase: Purchase) => {
    if (!authUser || purchase.buyer_id !== authUser.id || purchase.status !== "pending") return;
    setPurchaseActionLoading(purchase.id);
    try {
      const { error } = await supabase.rpc("cancel_purchase_request", {
        p_purchase_id: purchase.id,
      });
      if (error) throw error;
      setPurchaseRequestIds((current) => {
        const next = new Set(current);
        next.delete(String(purchase.listing_id));
        return next;
      });
      setPurchases((current) => current.map((item) => item.id === purchase.id ? { ...item, status: "cancelled" } : item));
    } catch (error) {
      Alert.alert("Unable to cancel request", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setPurchaseActionLoading(null);
    }
  };

  const refreshListings = async () => {
    try {
      setListings(await fetchListingsWithProfiles());
      if (profile?.role === "admin") {
        setAdminListings(await fetchListingsWithProfiles(true));
      }
    } catch (error) {
      Alert.alert("Unable to refresh marketplace", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const moderateListing = async () => {
    const listing = moderationTarget;
    if (!listing || profile?.role !== "admin" || moderationLoading) return;
    setModerationLoading(true);
    try {
      const { error } = await supabase.rpc("admin_remove_listing", {
        p_listing_id: Number(listing.id),
      });
      if (error) throw error;
      const removedAt = new Date().toISOString();
      setListings((current) => current.filter((item) => item.id !== listing.id));
      setAdminListings((current) => current.map((item) =>
        item.id === listing.id ? { ...item, removed_at: removedAt } : item
      ));
      await refreshListings();
      setModerationTarget(null);
      Alert.alert("Listing removed", "The listing was soft-removed from the marketplace. Purchase history is unchanged.");
    } catch (error) {
      Alert.alert("Unable to remove listing", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setModerationLoading(false);
    }
  };

  const checkStripeStatus = async () => {
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-connect-account",
        { body: { checkOnly: true } },
      );
      if (error) throw error;
      if (
        data?.status !== "connected" &&
        data?.status !== "setup_required" &&
        data?.status !== "setup_incomplete"
      ) {
        throw new Error("Stripe readiness status was not returned.");
      }
      setStripeStatus(data.status);
    } catch (error) {
      setStripeStatus("unknown");
      console.error("Unable to verify Stripe Connect readiness:", error);
      Alert.alert(
        "Unable to check Stripe payments",
        error instanceof Error ? error.message : "Please try again.",
      );
    }
  };

  const openMyMarket = async () => {
    const currentUser = authUser ?? (await supabase.auth.getUser()).data.user;
    if (!currentUser) return;
    setMyMarketLoading(true);
    setMyMarketError("");
    setShowMyMarket(true);
    try {
      const { data, error } = await supabase
        .from("purchases")
        .select("*, listing:listings(*)")
        .or(`buyer_id.eq.${currentUser.id},seller_id.eq.${currentUser.id}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const records = (data ?? []) as Purchase[];
      setPurchases(records.filter((purchase) => purchase.buyer_id === currentUser.id));
      setIncomingPurchases(records.filter((purchase) => purchase.seller_id === currentUser.id));
      if (profile?.role === "admin") {
        setAdminListings(await fetchListingsWithProfiles(true));
      } else {
        setAdminListings([]);
      }

      const { data: conversationData, error: conversationError } = await supabase
        .from("conversations")
        .select("*, listing:listings(*)")
        .or(`buyer_id.eq.${currentUser.id},seller_id.eq.${currentUser.id}`)
        .order("created_at", { ascending: false });
      if (conversationError) throw conversationError;

      const conversationsWithPreviews = await Promise.all(
        ((conversationData ?? []) as Conversation[]).map(async (item) => {
          const { data: latestMessage, error: messageError } = await supabase
            .from("messages")
            .select("id,sender_id,body,created_at")
            .eq("conversation_id", item.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (messageError) throw messageError;
          return { ...item, latest_message: latestMessage as Message | null };
        }),
      );
      setMarketConversations(conversationsWithPreviews);
      await checkStripeStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load My Market.";
      setMyMarketError(message);
      Alert.alert("Unable to load My Market", message);
    } finally {
      setMyMarketLoading(false);
    }
  };

  const refreshMyPurchases = async (userId: string) => {
    const { data, error } = await supabase
      .from("purchases")
      .select("*, listing:listings(*)")
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const records = (data ?? []) as Purchase[];
    setPurchases(records.filter((purchase) => purchase.buyer_id === userId));
    setIncomingPurchases(records.filter((purchase) => purchase.seller_id === userId));
    setPurchaseRequestIds(new Set(
    records
      .filter((purchase) => purchase.buyer_id === userId && ["pending", "accepted"].includes(purchase.status))
      .map((purchase) => String(purchase.listing_id)),
    ));
  };

  const authenticate = async () => {
    if (authLoading) return;
    setAuthError("");
    if (!email || !password || (isSignUp && !name)) {
      const message = "Please fill in all required fields.";
      setAuthError(message);
      Alert.alert("Missing information", message);
      return;
    }
    setAuthLoading(true);
    try {
      const result = isSignUp
        ? await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: { data: { full_name: name.trim() } },
          })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) {
        setAuthError(result.error.message);
        Alert.alert("Authentication failed", result.error.message);
        return;
      }
      if (!isSignUp && result.data.session?.user) {
        setAuthUser(result.data.session.user);
        setLoggedIn(true);
        return;
      }
      if (!isSignUp) {
        const message = "Sign-in succeeded, but Supabase did not return an active session.";
        setAuthError(message);
        Alert.alert("Authentication failed", message);
        return;
      }
      if (isSignUp && result.data.user) {
        const { error } = await supabase.from("profiles").upsert({
          id: result.data.user.id,
          full_name: name.trim(),
          email: result.data.user.email ?? null,
          avatar_url: null,
          role: "student",
        });
        if (error) {
          setAuthError(error.message);
          Alert.alert("Profile setup failed", error.message);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to contact Supabase.";
      setAuthError(message);
      Alert.alert("Authentication failed", message);
    } finally {
      setAuthLoading(false);
    }
  };

  const openConversation = async (listing: Listing, existingConversation?: Conversation) => {
    if (!authUser) {
      Alert.alert("Sign in required", "Sign in to contact a seller.");
      return;
    }
    if (!listing.seller_id || (listing.seller_id === authUser.id && !existingConversation)) {
      Alert.alert(
        listing.seller_id ? "This is your listing" : "Seller unavailable",
        listing.seller_id ? "You cannot message yourself." : "This listing has no authenticated seller.",
      );
      return;
    }
    if (listing.id == null) {
      Alert.alert("Unable to start chat", "This listing is missing its listing ID.");
      return;
    }
    setChatLoading(true);
    try {
      const listingId = Number(listing.id);
      const participantFilter = {
        listing_id: listingId,
        buyer_id: authUser.id,
        seller_id: listing.seller_id,
      };
      let conversationRecord = existingConversation ?? null;
      if (!conversationRecord) {
        const { data: buyerConversation, error: findError } = await supabase
          .from("conversations")
          .select("id,listing_id,buyer_id,seller_id,created_at")
          .eq("listing_id", listingId)
          .eq("buyer_id", authUser.id)
          .eq("seller_id", listing.seller_id)
          .maybeSingle();
        if (findError) throw findError;
        conversationRecord = buyerConversation as Conversation | null;
      }
      if (!conversationRecord) {
        const { data: createdConversation, error: createError } = await supabase
          .from("conversations")
          .insert(participantFilter)
          .select("id,listing_id,buyer_id,seller_id,created_at")
          .single();
        if (createError) {
          if (createError.code === "23505") {
            const { data: concurrentConversation, error: retryError } = await supabase
              .from("conversations")
              .select("id,listing_id,buyer_id,seller_id,created_at")
              .eq("listing_id", listingId)
              .eq("buyer_id", authUser.id)
              .eq("seller_id", listing.seller_id)
              .single();
            if (retryError) throw retryError;
            conversationRecord = concurrentConversation as Conversation;
          } else {
            throw createError;
          }
        } else {
          conversationRecord = createdConversation as Conversation;
        }
      }

      setConversation(conversationRecord);
      setMessages([]);
      const { data: messageData, error: messageError } = await supabase
        .from("messages")
        .select("id,sender_id,body,created_at")
        .eq("conversation_id", conversationRecord.id)
        .order("created_at", { ascending: true });
      if (messageError) {
        Alert.alert("Unable to load messages", messageError.message);
        return;
      }
      setMessages((messageData ?? []) as Message[]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start chat.";
      Alert.alert("Unable to start chat", message);
    } finally {
      setChatLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!authUser) {
      Alert.alert("Sign in required", "Sign in to send messages.");
      return;
    }
    if (!conversation || !messageText.trim() || messageSending) return;
    const recipientId =
      conversation.buyer_id === authUser.id ? conversation.seller_id : conversation.buyer_id;
    setMessageSending(true);
    try {
      const { error } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversation.id,
          listing_id: conversation.listing_id,
          sender_id: authUser.id,
          recipient_id: recipientId,
          body: messageText.trim(),
        });
      if (error) throw error;
      const { data: refreshedMessages, error: refreshError } = await supabase
        .from("messages")
        .select("id,sender_id,body,created_at")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true });
      if (refreshError) throw refreshError;
      setMessages((refreshedMessages ?? []) as Message[]);
      setMessageText("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send message.";
      Alert.alert("Unable to send message", message);
    } finally {
      setMessageSending(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setListings([]);
    setSelectedListing(null);
    setProfile(null);
    setPurchaseRequestIds(new Set());
  };

  const uploadListingImages = async (userId: string) => {
    const paths: string[] = [];
    for (const [index, asset] of itemFiles.entries()) {
      const extension = asset.fileName?.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${userId}/${Date.now()}-${index}.${extension}`;
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const { error } = await supabase.storage.from("listing-images").upload(path, blob, {
        contentType: asset.mimeType || "image/jpeg",
        upsert: false,
      });
      if (error) throw error;
      paths.push(path);
    }
    if (!paths.length && itemImage.trim()) paths.push(itemImage.trim());
    return paths;
  };

  const publishListing = async () => {
    if (publishLoading) return;
    setPublishError("");

    if (!itemTitle.trim() || !itemPrice.trim()) {
      const message = "Please enter an item name and price.";
      setPublishError(message);
      Alert.alert("Missing information", message);
      return;
    }

    setPublishLoading(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        throw new Error(userError?.message || "Your session has expired. Please sign in again.");
      }

      const imagePaths = await uploadListingImages(userData.user.id);
      const profile = await supabase.from("profiles").select("full_name,email").eq("id", userData.user.id).maybeSingle();
      const sellerNameValue = profile.data?.full_name?.trim() || profile.data?.email || userData.user.email || "Seller";

      const { error } = await supabase.from("listings").insert({
        title: itemTitle.trim(),
        description: itemDescription.trim(),
        category: itemCategory,
        seller_id: userData.user.id,
        seller: sellerNameValue,
        price: "$" + itemPrice.trim(),
        status: listingStatus,
        image: imagePaths[0] || null,
        image_url: imagePaths[0] || null,
        images: imagePaths,
      });
      if (error) {
        console.error("Publish listing INSERT failed:", error);
        throw new Error(`Supabase ${error.code}: ${error.message}`);
      }

      setListings(await fetchListingsWithProfiles());
      setItemTitle("");
      setItemPrice("");
      setItemDescription("");
      setItemImage("");
      setItemFiles([]);
      setListingStatus("Available");
      setShowSellForm(false);
      Alert.alert("Published", "Your item was listed!");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to publish your listing.";
      setPublishError(message);
      Alert.alert("Unable to publish listing", message);
    } finally {
      setPublishLoading(false);
    }
  };

  if (!loggedIn) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.loginContainer} keyboardShouldPersistTaps="handled">
          <View style={[styles.loginLayout, width < 960 && styles.loginLayoutCompact]}>
            <View style={[styles.loginImagePlaceholder, width < 960 && styles.loginImagePlaceholderCompact]}>
              <Image
                source={require("../../assets/images/WhatsApp Image 2026-10-04 at 17.59.25.jpeg")}
                style={styles.loginArtwork}
                resizeMode="contain"
                accessibilityLabel="University of the Cumberlands — Buy, Sell, Connect"
              />
            </View>

            <View style={[styles.loginForm, width < 960 && styles.loginFormCompact]}>
              <Text style={styles.logo}>UC MARKET</Text>
              <Text style={styles.tagline}>Buy. Sell. Connect.</Text>
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
                style={[styles.primaryButton, authLoading && styles.disabledButton]}
                disabled={authLoading}
                onPress={() => void authenticate()}
              >
                <Text style={styles.primaryButtonText}>
                  {authLoading ? (isSignUp ? "Creating account..." : "Signing in...") : isSignUp ? "Create account" : "Sign in"}
                </Text>
              </TouchableOpacity>
              {authError ? <Text style={styles.authError}>{authError}</Text> : null}

              <TouchableOpacity onPress={() => setIsSignUp(!isSignUp)}>
                <Text style={styles.switchText}>
                  {isSignUp
                    ? "Already have an account? Sign in"
                    : "Don't have an account? Create one"}
                </Text>
              </TouchableOpacity>
              <Text style={styles.creatorCredit}>Created by Lucas Saldo • © 2026</Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  

  const categories = [
    "All",
    "Textbooks",
    "Electronics",
    "Furniture",
    "Clothing",
    "Food",
    "Services",
  ];
  const selectedPurchase = selectedListing
    ? purchases.find((purchase) =>
        purchase.listing_id === Number(selectedListing.id) &&
        ["pending", "accepted", "cash_pending"].includes(purchase.status)
      )
    : undefined;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <View style={styles.header}>
          <Text style={styles.logoSmall}>UC MARKET</Text>

          <TouchableOpacity onPress={() => void signOut()}>
            <Text style={styles.logout}>Log out</Text>
          </TouchableOpacity>
          {Platform.OS !== "web" ? (
            <TouchableOpacity onPress={() => setShowConversations(true)}>
              <Text style={styles.logout}>Messages</Text>
            </TouchableOpacity>
          ) : null}
         
        </View>

        <View style={styles.profileBar}>
          {listingImageUrl(profile?.avatar_url) ? (
            <Image source={{ uri: listingImageUrl(profile?.avatar_url)! }} style={styles.profileAvatar} />
          ) : (
            <View style={styles.profileAvatarPlaceholder}><Text style={styles.profileAvatarText}>UC</Text></View>
          )}
          <View style={styles.profileCopy}>
            <Text style={styles.profileGreeting}>{profile?.full_name || "Your profile"}</Text>
            <Text style={styles.profileHint}>Your campus profile</Text>
          </View>
          <TouchableOpacity style={styles.profilePhotoButton} onPress={() => void chooseProfilePhoto()}>
            <Text style={styles.profilePhotoButtonText}>{profile?.avatar_url ? "Change profile photo" : "Add profile photo"}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.hero, { display: "none" }]}>
          <View style={[styles.heroVisual, isMobileHero && styles.mobileHeroVisual]}>
            <View style={styles.heroSky} />
            <View style={styles.heroHorizon} />
            <View style={styles.heroGround} />
            <View style={styles.heroWalkway} />
            <View style={styles.heroTower}>
              <View style={styles.heroTowerRoof} />
              <View style={styles.heroTowerBody}><View style={styles.heroTowerWindow} /></View>
            </View>
            {!isMobileHero ? <>
              <View style={styles.heroBuildingOne}><View style={styles.heroBuildingRoof} /><View style={styles.heroBuildingWindow} /></View>
              <View style={styles.heroBuildingTwo}><View style={styles.heroBuildingRoof} /><View style={styles.heroBuildingWindow} /></View>
              <View style={styles.heroHome}><Text style={styles.heroHomeText}>HOME</Text><Text style={styles.heroHomeMark}>UC</Text><View style={styles.heroHomeBase} /></View>
            </> : null}
            <View style={styles.heroGlobe}>
              <View style={styles.heroGlobeLatitude} />
              <View style={styles.heroGlobeLongitude} />
              <View style={styles.heroGlobeStand} />
            </View>
            <View style={styles.heroBridge}>
              <View style={styles.heroBridgeDeck} /><View style={styles.heroBridgeArch} /><View style={styles.heroBridgeRail} />
            </View>
            <Text style={isMobileHero ? styles.heroMobileEyebrow : styles.heroEyebrow}>UC CAMPUS EXCHANGE</Text>
            <Text style={isMobileHero ? styles.heroMobileWelcome : styles.heroWelcome}>Welcome, Patriots!</Text>
            <Text style={isMobileHero ? styles.heroMobileTitle : styles.heroTitle}>Buy. Sell. Connect.</Text>
            {!isMobileHero ? <Text style={styles.heroNote}>A student marketplace built around campus life.</Text> : null}
            <View style={isMobileHero ? styles.heroMobileBooth : styles.heroBooth}>
              <View style={styles.heroBoothCanopy}><Text style={styles.heroBoothLabel}>PATRIOT MARKET</Text></View>
              <View style={styles.heroBoothCounter}><View style={styles.heroProductBook} /><View style={styles.heroProductDevice} /><View style={styles.heroProductPackage} /></View>
            </View>
            <View style={styles.heroCharacters}>
              {isMobileHero ? <>
                <PatriotCharacter className="handshake" position="MobileHandshakeLeft" />
                <PatriotCharacter className="handshake" position="MobileHandshakeRight" />
              </> : <>
                <PatriotCharacter className="seller" position="Seller" />
                <PatriotCharacter className="handshake" position="HandshakeLeft" />
                <PatriotCharacter className="handshake" position="HandshakeRight" />
                <PatriotCharacter className="package" position="Package" />
              </>}
            </View>
          </View>

          <TextInput
            style={styles.search}
            placeholder="🔎  Search items, food, services..."
            value={search}
            onChangeText={setSearch}
          />
        </View>


        <View style={{ gap: 8, marginBottom: 12 }}>
  <TouchableOpacity
    style={styles.filterOption}
    onPress={() => setShowCategoryMenu(!showCategoryMenu)}
  >
    <Text style={styles.filterOptionText}>
      Category: {category} ▾
    </Text>
  </TouchableOpacity>

  {showCategoryMenu && (
    <View style={{ gap: 6 }}>
      {categories.map((categoryName) => (
        <TouchableOpacity
          key={categoryName}
          style={[
            styles.filterOption,
            category === categoryName && styles.filterOptionActive,
          ]}
          onPress={() => {
            setCategory(categoryName);
            setShowCategoryMenu(false);
          }}
        >
          <Text
            style={
              category === categoryName
                ? styles.filterOptionTextActive
                : styles.filterOptionText
            }
          >
            {categoryName}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  )}

  <TouchableOpacity
    style={styles.filterOption}
    onPress={() => setShowFilterMenu(!showFilterMenu)}
  >
    <Text style={styles.filterOptionText}>
      Filter & Sort: {availability} · {
        sortOrder === "newest"
          ? "Newest"
          : sortOrder === "lowPrice"
          ? "Price Low"
          : "Price High"
      } ▾
    </Text>
  </TouchableOpacity>

  {showFilterMenu && (
    <View style={{ gap: 6 }}>
      {["All", "Available", "Pending", "Reserved", "Sold"].map((option) => (
        <TouchableOpacity
          key={option}
          style={styles.filterOption}
          onPress={() => {
            setAvailability(option);
            setShowFilterMenu(false);
          }}
        >
          <Text style={styles.filterOptionText}>{option}</Text>
        </TouchableOpacity>
      ))}

      {[
        { key: "newest", label: "Newest" },
        { key: "lowPrice", label: "Price Low" },
        { key: "highPrice", label: "Price High" },
      ].map((option) => (
        <TouchableOpacity
          key={option.key}
          style={styles.filterOption}
          onPress={() => {
            setSortOrder(option.key);
            setShowFilterMenu(false);
          }}
        >
          <Text style={styles.filterOptionText}>{option.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )}
</View>
<ScrollView
  horizontal
  showsHorizontalScrollIndicator={false}
  contentContainerStyle={{ gap: 10, paddingVertical: 12 }}
>
  {[
    { key: "sell", label: "Sell Something" },
    { key: "favorites", label: "Favorites" },
    { key: "purchases", label: "My Purchases" },
    { key: "sales", label: "Sales Requests" },
    { key: "messages", label: "Messages" },
  ].map((item) => (
    <TouchableOpacity
      key={item.key}
      style={[
        styles.filterOption,
        marketSection === item.key && styles.filterOptionActive,
        { paddingHorizontal: 18, paddingVertical: 12 }
      ]}
      onPress={() => {
        if (item.key === "sell") {
          setShowSellForm(true);
          return;
        }

        setMarketSection(item.key as typeof marketSection);
        setShowMyMarket(true);
        void openMyMarket();
      }}
    >
      <Text
        style={
          marketSection === item.key
            ? styles.filterOptionTextActive
            : styles.filterOptionText
        }
      >
        {item.label}
      </Text>
    </TouchableOpacity>
  ))}
    {profile?.role === "admin" ? (
      <TouchableOpacity
        style={[
          styles.filterOption,
          marketSection === "staff" && styles.filterOptionActive,
          { paddingHorizontal: 18, paddingVertical: 12 },
        ]}
        onPress={() => {
          setMarketSection("staff");
          setShowMyMarket(true);
          void openMyMarket();
        }}
      >
        <Text style={marketSection === "staff" ? styles.filterOptionTextActive : styles.filterOptionText}>
          Admin Dashboard
        </Text>
      </TouchableOpacity>
    ) : null}
</ScrollView>
        <View style={styles.list}>
          {loadingListings ? <ActivityIndicator color="#7A1530" /> : null}
          {listingError ? <Text style={styles.authError}>{listingError}</Text> : null}
          {listings
            .filter((item) => category === "All" || item.category === category)
            .filter((item) => availability === "All" || (item.status ?? "Available") === availability)
            .filter((item) => [item.title, item.description, item.category, item.seller].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()))
            .sort((first, second) => {
              if (sortOrder === "newest") return new Date(second.created_at || 0).getTime() - new Date(first.created_at || 0).getTime();
              const firstPrice = Number.parseFloat(first.price.replace(/[^0-9.]/g, "")) || 0;
              const secondPrice = Number.parseFloat(second.price.replace(/[^0-9.]/g, "")) || 0;
              return sortOrder === "lowPrice" ? firstPrice - secondPrice : secondPrice - firstPrice;
            })
            .map((item) => (
              <TouchableOpacity
                key={item.id ?? item.title}
                style={styles.card}
                onPress={() => openListingDetails(item)}
              >
                <View style={styles.iconBox}>
                  {listingImageUrl(item.image_url || item.image) ? (
                    <Image source={{ uri: listingImageUrl(item.image_url || item.image)! }} style={styles.cardImage} />
                  ) : item.emoji ? (
                    <Text style={styles.emoji}>{item.emoji}</Text>
                  ) : (
                    <Text style={styles.placeholderIcon}>📦</Text>
                  )}
                </View>

                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardCategory}>
                    {item.category}
                  </Text>
                  <Text style={styles.seller}>
                    {sellerName(item)}
                  </Text>
                </View>

                {listingImageUrl(getProfile(item)?.avatar_url) ? (
                  <Image source={{ uri: listingImageUrl(getProfile(item)?.avatar_url)! }} style={styles.cardAvatar} />
                ) : (
                  <View style={styles.cardAvatarPlaceholder}><Text style={styles.cardAvatarText}>UC</Text></View>
                )}

                <Text style={styles.price}>{item.price}</Text>
                {item.seller_id !== authUser?.id ? (
                  <TouchableOpacity
                    disabled={favoriteLoadingIds.has(String(item.id))}
                    onPress={(event) => { event.stopPropagation(); void toggleFavorite(item); }}
                  >
                  <Text style={styles.favorite}>{favorites.has(String(item.id)) ? "♥" : "♡"}</Text>
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
            ))}
        </View>

        

        <Text style={styles.footer}>
          UC Market • Made for students
        </Text>
        <Text style={styles.creatorCredit}>Created by Lucas Saldo • © 2026</Text>
      </ScrollView>

        <Modal
          visible={selectedListing !== null}
          animationType="slide"
          onRequestClose={() => setSelectedListing(null)}
        >
          {selectedListing && (
            <SafeAreaView style={styles.detailContainer}>
              <ScrollView contentContainerStyle={styles.detailContent}>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => setSelectedListing(null)}
                >
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>

                {listingImages(selectedListing).length ? (
                  <View>
                    <Image
                      source={{ uri: listingImageUrl(activeDetailImage || listingImages(selectedListing)[0])! }}
                      style={styles.detailMainImage}
                    />
                    {listingImages(selectedListing).length > 1 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.detailThumbnailRow}>
                        {listingImages(selectedListing).map((image) => (
                          <TouchableOpacity key={image} onPress={() => setActiveDetailImage(image)}>
                            <Image
                              source={{ uri: listingImageUrl(image)! }}
                              style={[styles.detailThumbnail, image === (activeDetailImage || listingImages(selectedListing)[0]) && styles.detailThumbnailActive]}
                            />
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.detailImagePlaceholder}>
                    <Text style={styles.placeholderText}>No photo provided</Text>
                  </View>
                )}

                <Text style={styles.detailTitle}>{selectedListing.title}</Text>
                <Text style={styles.detailCategory}>{selectedListing.category}</Text>
                <Text style={styles.detailPrice}>{selectedListing.price}</Text>
                <Text style={[styles.status, selectedListing.status === "Sold" && styles.soldStatus]}>
                  {selectedPurchase ? purchaseStatusLabel(selectedPurchase) : selectedListing.status || "Available"}
                </Text>
                <View style={styles.sellerRow}>
                  {listingImageUrl(getProfile(selectedListing)?.avatar_url) ? (
                    <Image source={{ uri: listingImageUrl(getProfile(selectedListing)?.avatar_url)! }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatarPlaceholder}><Text>👤</Text></View>
                  )}
                  <View>
                    <Text style={styles.detailSeller}>
                      {selectedListing.seller_id === authUser?.id ? "Your listing" : sellerName(selectedListing)}
                    </Text>
                    <Text style={styles.detailEmail}>
                      {getProfile(selectedListing)?.email || "Seller email unavailable"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.detailDescription}>
                  {selectedListing.description || "No description provided."}
                </Text>

                {selectedListing.seller_id !== authUser?.id ? (
                  <>
                    {selectedPurchase?.status === "pending" ? (
                      <>
                        <Text style={styles.contactHint}>Purchase request sent — waiting for the seller to accept.</Text>
                        <TouchableOpacity
                          style={[styles.purchaseDeclineButton, styles.detailPurchaseButton]}
                          disabled={purchaseActionLoading === selectedPurchase.id}
                          onPress={() => void cancelPurchaseRequest(selectedPurchase)}
                        >
                          <Text style={styles.purchaseDeclineText}>Cancel request</Text>
                        </TouchableOpacity>
                      </>
                    ) : selectedPurchase?.status === "accepted" ? (
                      <View style={styles.detailPurchaseActions}>
                        <Text style={styles.contactHint}>Accepted / Reserved for you. Choose a payment option:</Text>
                        <TouchableOpacity
                          style={[styles.purchaseAcceptButton, styles.detailPurchaseButton]}
                          disabled={purchaseActionLoading === selectedPurchase.id}
                          onPress={() => void payForPurchase(selectedPurchase)}
                        >
                          <Text style={styles.purchaseAcceptText}>Pay securely online</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.purchaseCashButton, styles.detailPurchaseButton, selectedPurchase.stripe_checkout_session_id && styles.disabledButton]}
                          disabled={Boolean(selectedPurchase.stripe_checkout_session_id) || purchaseActionLoading === selectedPurchase.id}
                          onPress={() => void chooseCashPurchase(selectedPurchase)}
                        >
                          <Text style={styles.purchaseCashText}>Pay in person / Cash</Text>
                        </TouchableOpacity>
                        {selectedPurchase.stripe_checkout_session_id ? (
                          <Text style={styles.contactHint}>An online Checkout session is active. Cash can be selected after that session expires.</Text>
                        ) : null}
                      </View>
                    ) : selectedPurchase?.status === "cash_pending" ? (
                      <Text style={styles.contactHint}>Pay in person with the seller. The listing is not marked sold until the seller confirms receiving the cash.</Text>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={styles.buyButton}
                          disabled={purchaseLoading || (selectedListing.status ?? "Available") !== "Available"}
                          onPress={() => void requestPurchase(selectedListing)}
                        >
                          <Text style={styles.buyButtonText}>
                            {selectedListing.status === "Sold"
                              ? "Sold"
                              : (selectedListing.status ?? "Available") === "Reserved"
                                ? "Reserved"
                                : purchaseLoading
                                  ? "Sending request..."
                                  : purchaseRequestIds.has(String(selectedListing.id))
                                    ? "Check request status"
                                    : "Request to buy"}
                          </Text>
                        </TouchableOpacity>
                        {purchaseError ? <Text style={styles.authError}>{purchaseError}</Text> : null}
                        <Text style={styles.contactHint}>
                          {selectedListing.status === "Sold"
                            ? "This listing is no longer available."
                            : selectedListing.status === "Reserved"
                              ? "This item is reserved for an accepted buyer."
                              : selectedListing.status === "Pending"
                                ? "This listing is currently unavailable."
                                : purchaseRequestIds.has(String(selectedListing.id))
                                  ? "Check your active request; a duplicate request will not be created."
                                : "Request to buy. No payment is taken unless the seller accepts."}
                        </Text>
                      </>
                    )}
                    <Pressable
                      style={styles.chatButton}
                      disabled={chatLoading || selectedListing.status === "Sold" || selectedListing.status === "Reserved"}
                      onPress={() => void openConversation(selectedListing)}
                    >
                      <Text style={styles.chatButtonText}>Chat with Seller</Text>
                    </Pressable>
                    <TouchableOpacity style={styles.favoriteDetail} disabled={favoriteLoadingIds.has(String(selectedListing.id))} onPress={() => void toggleFavorite(selectedListing)}>
                      <Text style={styles.chatButtonText}>{favoriteLoadingIds.has(String(selectedListing.id)) ? "Saving..." : favorites.has(String(selectedListing.id)) ? "♥ Saved" : "♡ Save favorite"}</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
                {selectedListing.seller_id === authUser?.id ? (
                  <View style={styles.statusControls}>
                    <TouchableOpacity style={styles.editListingButton} onPress={() => openEditListing(selectedListing)}>
                      <Text style={styles.editListingButtonText}>Edit listing</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteListingButton} onPress={() => setDeleteTarget(selectedListing)} disabled={deleteLoading}>
                      <Text style={styles.deleteListingButtonText}>Delete listing</Text>
                    </TouchableOpacity>
                    <Text style={styles.statusLabel}>Seller status</Text>
                    {selectedListing.status === "Reserved" || selectedListing.status === "Sold" ? (
                      <Text style={styles.editImageHint}>
                        {selectedListing.status === "Reserved" ? "Reserved until the purchase is completed." : "Sold listings cannot be reopened."}
                      </Text>
                    ) : (
                      (["Available", "Pending", "Sold"] as const).map((status) => (
                        <TouchableOpacity key={status} style={[styles.statusOption, selectedListing.status === status && styles.statusOptionActive]} onPress={() => void updateListingStatus(selectedListing, status)}>
                          <Text style={selectedListing.status === status ? styles.statusOptionTextActive : styles.statusOptionText}>{status}</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </View>
                ) : null}
              </ScrollView>
            </SafeAreaView>
          )}
        </Modal>

        <Modal visible={showEditListing} animationType="slide" onRequestClose={() => setShowEditListing(false)}>
          <SafeAreaView style={styles.detailContainer}>
            <ScrollView contentContainerStyle={styles.editContent}>
              <View style={styles.editHeader}>
                <TouchableOpacity onPress={() => setShowEditListing(false)}>
                  <Text style={styles.closeButtonText}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.formTitle}>Edit listing</Text>
              </View>
              <TextInput style={styles.input} placeholder="What are you selling?" value={editTitle} onChangeText={setEditTitle} />
              <TextInput style={styles.input} placeholder="Price" value={editPrice} onChangeText={setEditPrice} keyboardType="decimal-pad" />
              <TextInput style={[styles.input, styles.editDescriptionInput]} placeholder="Description / condition" value={editDescription} onChangeText={setEditDescription} multiline />
              <Text style={styles.editFieldLabel}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editOptionRow}>
                {categories.filter((categoryName) => categoryName !== "All").map((categoryName) => (
                  <TouchableOpacity key={categoryName} style={[styles.editOption, editCategory === categoryName && styles.editOptionActive]} onPress={() => setEditCategory(categoryName)}>
                    <Text style={editCategory === categoryName ? styles.editOptionTextActive : styles.editOptionText}>{categoryName}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={styles.editFieldLabel}>Status</Text>
              {editStatus === "Reserved" || editStatus === "Sold" ? (
                <Text style={styles.editImageHint}>
                  {editStatus === "Reserved" ? "Reserved while this purchase is completed; sellers cannot reopen it." : "Sold listings cannot be reopened."}
                </Text>
              ) : (
                <View style={styles.editOptionRow}>
                  {(["Available", "Pending", "Sold"] as const).map((status) => (
                    <TouchableOpacity key={status} style={[styles.editOption, editStatus === status && styles.editOptionActive]} onPress={() => setEditStatus(status)}>
                      <Text style={editStatus === status ? styles.editOptionTextActive : styles.editOptionText}>{status}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Text style={styles.editFieldLabel}>Images</Text>
              <Text style={styles.editImageHint}>{selectedListing && listingImages(selectedListing).length ? `${listingImages(selectedListing).length} existing image(s)` : "No existing images"}</Text>
              <TouchableOpacity style={styles.imagePicker} onPress={() => void chooseEditImages()}>
                <Text style={styles.chatButtonText}>{editFiles.length ? `${editFiles.length} new image(s) selected` : "Add more listing images"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.sellButton, editLoading && styles.disabledButton]} disabled={editLoading} onPress={() => void saveEditedListing()}>
                <Text style={styles.sellButtonText}>{editLoading ? "Saving changes..." : "Save changes"}</Text>
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </Modal>

        <Modal visible={deleteTarget !== null} transparent animationType="fade" onRequestClose={() => { if (!deleteLoading) setDeleteTarget(null); }}>
          <View style={styles.deleteConfirmBackdrop}>
            <View style={styles.deleteConfirmCard}>
              <Text style={styles.deleteConfirmTitle}>Delete listing</Text>
              <Text style={styles.deleteConfirmMessage}>Are you sure you want to delete this listing?</Text>
              <View style={styles.deleteConfirmActions}>
                <TouchableOpacity style={styles.deleteCancelButton} disabled={deleteLoading} onPress={() => setDeleteTarget(null)}>
                  <Text style={styles.deleteCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteConfirmButton} disabled={deleteLoading} onPress={() => void confirmDeleteListing()}>
                  <Text style={styles.deleteConfirmText}>{deleteLoading ? "Deleting..." : "Delete"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={moderationTarget !== null} transparent animationType="fade" onRequestClose={() => { if (!moderationLoading) setModerationTarget(null); }}>
          <View style={styles.deleteConfirmBackdrop}>
            <View style={styles.deleteConfirmCard}>
              <Text style={styles.deleteConfirmTitle}>Remove marketplace listing?</Text>
              <Text style={styles.deleteConfirmMessage}>
                {moderationTarget?.title ? `"${moderationTarget.title}" will be hidden from the marketplace. Its purchase history will be preserved.` : "This listing will be hidden from the marketplace."}
              </Text>
              <View style={styles.deleteConfirmActions}>
                <TouchableOpacity style={styles.deleteCancelButton} disabled={moderationLoading} onPress={() => setModerationTarget(null)}>
                  <Text style={styles.deleteCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteConfirmButton} disabled={moderationLoading} onPress={() => void moderateListing()}>
                  <Text style={styles.deleteConfirmText}>{moderationLoading ? "Removing..." : "Remove listing"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        
      <Modal
        visible={showSellForm}
        animationType="slide"
        onRequestClose={() => setShowSellForm(false)}
      >
        <SafeAreaView style={styles.detailContainer}>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <TouchableOpacity onPress={() => setShowSellForm(false)}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>

            <View style={{ padding: 20 }}>
    <Text>Sell an item</Text>
    <TextInput
  placeholder="What are you selling?"
  style={styles.search}
  value={itemTitle}
  onChangeText={setItemTitle}
/>
<TextInput
  placeholder="Price"
  style={styles.search}
  value={itemPrice}
  onChangeText={setItemPrice}
/>
<TextInput
  placeholder="Description / condition"
  style={styles.search}
  value={itemDescription}
  onChangeText={setItemDescription}
/>
<Text>Category: {itemCategory}</Text>
<TouchableOpacity onPress={() => setItemCategory("Furniture")}>
<Text>Furniture</Text>
</TouchableOpacity>
<TouchableOpacity onPress={() => setItemCategory("Electronics")}>
<Text>Electronics</Text>
</TouchableOpacity>
<TouchableOpacity onPress={() => setItemCategory("Clothing")}>
<Text>Clothing</Text>
</TouchableOpacity>
<Text>Status: {listingStatus}</Text>
{(["Available", "Pending"] as const).map((status) => (
  <TouchableOpacity key={status} onPress={() => setListingStatus(status)}>
    <Text>{status}</Text>
  </TouchableOpacity>
))}
<TouchableOpacity style={styles.imagePicker} onPress={() => void chooseImages()}>
  <Text style={styles.chatButtonText}>{itemFiles.length ? `${itemFiles.length} image(s) selected` : "Add listing images"}</Text>
</TouchableOpacity>
{publishError ? <Text style={styles.authError}>{publishError}</Text> : null}
<TouchableOpacity
  style={[styles.sellButton, publishLoading && styles.disabledButton]}
  disabled={publishLoading}
  onPress={() => void publishListing()}
>
  <Text style={styles.sellButtonText}>
    {publishLoading ? "Publishing..." : "Publish listing"}
  </Text>
</TouchableOpacity>
  </View>

          </ScrollView>
        </SafeAreaView>
      </Modal>

<Modal visible={showMyMarket} animationType="slide" onRequestClose={() => setShowMyMarket(false)}>
          <SafeAreaView style={styles.detailContainer}>
            <View style={styles.chatHeader}>
              <TouchableOpacity onPress={() => setShowMyMarket(false)}><Text style={styles.closeButtonText}>Close</Text></TouchableOpacity>
              <Text style={styles.formTitle}>My Market</Text>
            </View>
            <ScrollView contentContainerStyle={styles.myMarketContent}>
              {myMarketLoading ? <ActivityIndicator color="#7A1530" /> : null}
              {myMarketError ? <Text style={styles.myMarketError}>{myMarketError}</Text> : null}

              {profile?.role === "staff" || profile?.role === "admin" ? (
                <View style={styles.roleSummary}>
                  <Text style={styles.roleSummaryName}>{profile.full_name || profile.email || "UC Market user"}</Text>
                  <Text style={styles.roleBadge}>{profile.role === "admin" ? "ADMIN" : "STAFF"}</Text>
                </View>
              ) : null}

              
              <TouchableOpacity
                style={{
                  backgroundColor: "#7A1530",
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  borderRadius: 12,
                  marginBottom: 12,
                }}
                onPress={async () => {
                  try {
                    const { data, error } =
                      await supabase.functions.invoke(
                        "create-connect-account",
                        { body: {} },
                      );

                    if (error) throw error;
                    if (data?.status === "connected" || data?.connected) {
                      setStripeStatus("connected");
                      Alert.alert("Stripe connected", "Your Stripe payments account is ready to receive payments.");
                      return;
                    }
                    setStripeStatus(data?.status === "setup_required" ? "setup_required" : "setup_incomplete");

                    if (!data?.onboardingUrl) {
                      throw new Error(
                        data?.error ||
                          "Stripe onboarding link was not returned.",
                      );
                    }

                    await Linking.openURL(data.onboardingUrl);
                  } catch (error) {
                    Alert.alert(
                      "Stripe setup failed",
                      error instanceof Error
                        ? error.message
                        : "Unable to connect Stripe.",
                    );
                  }
                }}
              >
                <Text
                  style={{
                    color: "#FFFFFF",
                    textAlign: "center",
                    fontWeight: "800",
                  }}
                >
                  {stripeStatus === "connected"
                    ? "Stripe payments connected ✓"
                    : stripeStatus === "setup_incomplete"
                      ? "Finish Stripe setup"
                      : "Set up Stripe payments"}
                </Text>
              </TouchableOpacity>

              {marketSection === "favorites" && (
  <>
<Text style={styles.myMarketSection}>Favorites</Text>
              {listings.filter((listing) => favorites.has(String(listing.id))).map((listing) => (
                <View key={String(listing.id)} style={styles.myMarketRow}>
                  {listingImageUrl(listing.image_url || listing.image) ? <Image source={{ uri: listingImageUrl(listing.image_url || listing.image)! }} style={styles.myMarketThumbnail} /> : <View style={styles.myMarketThumbnailPlaceholder}><Text>📦</Text></View>}
                  <View style={styles.myMarketRowContent}>
                    <Text style={styles.cardTitle}>{listing.title}</Text>
                    <Text style={styles.seller}>{sellerName(listing)} · {listing.price} · {listing.status || "Available"}</Text>
                    <View style={styles.myMarketActionRow}>
                      <TouchableOpacity onPress={() => { setShowMyMarket(false); openListingDetails(listing); }}><Text style={styles.myMarketAction}>Open</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => void toggleFavorite(listing)} disabled={favoriteLoadingIds.has(String(listing.id))}><Text style={styles.myMarketDeleteAction}>{favoriteLoadingIds.has(String(listing.id)) ? "Saving..." : "Remove favorite"}</Text></TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))}
              {!listings.some((listing) => favorites.has(String(listing.id))) ? <Text style={styles.contactHint}>No favorites yet.</Text> : null}

              
  </>
)}

{marketSection === "purchases" && (
  <>
<Text style={styles.myMarketSection}>My Purchases</Text>
              {purchases.length ? purchases.map((purchase) => (
                <View key={purchase.id} style={styles.myMarketRow}>
                  <View style={styles.myMarketRowContent}>
                    <Text style={styles.cardTitle}>{purchase.listing?.title || `Listing #${purchase.listing_id}`}</Text>
                    <Text style={styles.seller}>{purchase.listing ? sellerName(purchase.listing) : "Seller unavailable"} · {purchase.price} · {purchaseStatusLabel(purchase)}</Text>
                    {purchase.status === "accepted" ? (
                      <View style={styles.purchaseActions}>
                        <TouchableOpacity
                          style={styles.purchaseAcceptButton}
                          disabled={purchaseActionLoading === purchase.id}
                          onPress={() => void payForPurchase(purchase)}
                        >
                          <Text style={styles.purchaseAcceptText}>
                            {purchaseActionLoading === purchase.id ? "Opening..." : "Pay securely online"}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.purchaseCashButton, (purchase.stripe_checkout_session_id || purchaseActionLoading === purchase.id) && styles.disabledButton]}
                          disabled={Boolean(purchase.stripe_checkout_session_id) || purchaseActionLoading === purchase.id}
                          onPress={() => void chooseCashPurchase(purchase)}
                        >
                          <Text style={styles.purchaseCashText}>Pay in person / Cash</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                    {purchase.status === "pending" ? (
                      <TouchableOpacity
                        style={[styles.purchaseDeclineButton, styles.detailPurchaseButton]}
                        disabled={purchaseActionLoading === purchase.id}
                        onPress={() => void cancelPurchaseRequest(purchase)}
                      >
                        <Text style={styles.purchaseDeclineText}>
                          {purchaseActionLoading === purchase.id ? "Cancelling..." : "Cancel request"}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                    {purchase.status === "cash_pending" ? (
                      <Text style={styles.contactHint}>Meet the seller to exchange the item and cash. The seller must confirm receipt before the listing is marked sold.</Text>
                    ) : null}
                  </View>
                </View>
              )) : <Text style={styles.contactHint}>No purchase requests yet.</Text>}

              
  </>
)}

{marketSection === "sales" && (
  <>
<Text style={styles.myMarketSection}>Sales Requests</Text>
              {incomingPurchases.length ? incomingPurchases.map((purchase) => (
                <View key={purchase.id} style={styles.myMarketRow}>
                  <View style={styles.myMarketRowContent}>
                    <Text style={styles.cardTitle}>{purchase.listing?.title || `Listing #${purchase.listing_id}`}</Text>
                    <Text style={styles.seller}>Buyer {purchase.buyer_id.slice(0, 8)} · {purchase.price} · {purchaseStatusLabel(purchase)}</Text>
                    {purchase.status === "pending" ? <View style={styles.purchaseActions}>
                      <TouchableOpacity style={styles.purchaseAcceptButton} disabled={purchaseActionLoading === purchase.id} onPress={() => void updatePurchaseStatus(purchase, "accepted")}><Text style={styles.purchaseAcceptText}>{purchaseActionLoading === purchase.id ? "Saving..." : "Accept"}</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.purchaseDeclineButton} disabled={purchaseActionLoading === purchase.id} onPress={() => void updatePurchaseStatus(purchase, "declined")}><Text style={styles.purchaseDeclineText}>Decline</Text></TouchableOpacity>
                    </View> : null}
                    {purchase.status === "accepted" ? <Text style={styles.contactHint}>Accepted — the item is reserved for this buyer and payment is required.</Text> : null}
                    {purchase.status === "cash_pending" ? (
                      <>
                        <Text style={styles.contactHint}>Confirm only after you have received the cash in person.</Text>
                        <TouchableOpacity
                          style={[styles.purchaseAcceptButton, styles.detailPurchaseButton]}
                          disabled={purchaseActionLoading === purchase.id}
                          onPress={() => void confirmCashPurchase(purchase)}
                        >
                          <Text style={styles.purchaseAcceptText}>
                            {purchaseActionLoading === purchase.id ? "Saving..." : "Confirm cash received"}
                          </Text>
                        </TouchableOpacity>
                      </>
                    ) : null}
                  </View>
                </View>
              )) : <Text style={styles.contactHint}>No incoming purchase requests.</Text>}

              
  </>
)}

{(marketSection === "messages" || marketSection === "chat") && (
  <>
<Text style={styles.myMarketSection}>Messages</Text>
              {marketConversations.length ? marketConversations.map((item) => (
                <TouchableOpacity key={item.id} style={styles.myMarketRow} onPress={() => { setShowMyMarket(false); if (item.listing) void openConversation(item.listing, item); else Alert.alert("Conversation unavailable", "The related listing is no longer available."); }}>
                  <View style={styles.myMarketRowContent}>
                    <Text style={styles.cardTitle}>{item.listing?.title || `Listing #${item.listing_id}`}</Text>
                    <Text style={styles.seller}>{item.buyer_id === authUser?.id ? `Seller: ${sellerName(item.listing || { title: "", category: "", price: "" })}` : "Buyer conversation"}</Text>
                    <Text style={styles.messagePreview}>{item.latest_message?.body || "No messages yet"}</Text>
                  </View>
                </TouchableOpacity>
              )) : <Text style={styles.contactHint}>No conversations yet.</Text>}
            
  </>
)}

{marketSection === "staff" && profile?.role === "admin" && (
  <View>
    <View style={styles.adminDashboardHeader}>
      <View>
        <Text style={styles.myMarketSection}>Admin Dashboard</Text>
        <Text style={styles.contactHint}>Review listings across UC Market. Removed listings are soft-hidden; purchase history is preserved.</Text>
      </View>
      <TouchableOpacity onPress={() => void refreshListings()} disabled={myMarketLoading}>
        <Text style={styles.myMarketAction}>Refresh</Text>
      </TouchableOpacity>
    </View>
    {adminListings.length ? adminListings.map((listing) => (
      <View key={String(listing.id)} style={styles.adminListingRow}>
        <View style={styles.myMarketRowContent}>
          <Text style={styles.cardTitle}>{listing.title}</Text>
          <Text style={styles.seller}>Seller: {sellerName(listing)} · {listing.price}</Text>
          <Text style={styles.seller}>Status: {listing.removed_at ? "Removed" : listing.status || "Available"} · Created: {listing.created_at ? new Date(listing.created_at).toLocaleDateString() : "Date unavailable"}</Text>
        </View>
        {listing.removed_at ? (
          <Text style={styles.removedListingLabel}>Removed</Text>
        ) : (
          <TouchableOpacity
            style={styles.moderateButton}
            disabled={moderationLoading}
            onPress={() => setModerationTarget(listing)}
          >
            <Text style={styles.moderateButtonText}>Remove</Text>
          </TouchableOpacity>
        )}
      </View>
    )) : <Text style={styles.contactHint}>No listings found.</Text>}
  </View>
)}
</ScrollView>
          </SafeAreaView>
        </Modal>

        <Modal
          visible={conversation !== null}
          animationType="slide"
          onRequestClose={() => setConversation(null)}
        >
          <SafeAreaView style={styles.detailContainer}>
            <View style={styles.chatHeader}>
              <TouchableOpacity onPress={() => setConversation(null)}>
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
              <Text style={styles.formTitle}>Conversation</Text>
            </View>
            <ScrollView contentContainerStyle={styles.messages}>
              {messages.map((message) => (
                <View
                  key={message.id}
                  style={[
                    styles.message,
                    message.sender_id === authUser?.id && styles.myMessage,
                  ]}
                >
                  <Text>{message.body}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={styles.messageComposer}>
              <TextInput
                style={styles.messageInput}
                placeholder="Message the seller..."
                value={messageText}
                onChangeText={setMessageText}
              />
              <TouchableOpacity style={[styles.sendButton, messageSending && styles.disabledButton]} disabled={messageSending} onPress={() => void sendMessage()}>
                <Text style={styles.sendText}>{messageSending ? "Sending..." : "Send"}</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Modal>

        <Modal visible={showConversations} animationType="slide" onRequestClose={() => setShowConversations(false)}>
          <SafeAreaView style={styles.detailContainer}>
            <View style={styles.chatHeader}>
              <TouchableOpacity onPress={() => setShowConversations(false)}><Text style={styles.closeButtonText}>Close</Text></TouchableOpacity>
              <Text style={styles.formTitle}>Messages</Text>
            </View>
            <ScrollView contentContainerStyle={styles.messages}>
              {!conversations.length ? <Text style={styles.contactHint}>No conversations yet.</Text> : conversations.map((item) => (
                <TouchableOpacity key={item.id} style={styles.conversationRow} onPress={() => { setShowConversations(false); if (item.listing) void openConversation(item.listing, item); }}>
                  <Text style={styles.cardTitle}>{item.listing?.title || `Listing #${item.listing_id}`}</Text>
                  <Text style={styles.seller}>{item.buyer_id === authUser?.id ? "Buyer conversation" : "Seller conversation"}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </SafeAreaView>
        </Modal>

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
    paddingHorizontal: 20,
    paddingVertical: 28,
  },

  loginLayout: {
    width: "100%",
    maxWidth: 1480,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 28,
  },

  loginLayoutCompact: {
    flexDirection: "column",
    gap: 20,
  },

  loginImagePlaceholder: {
    width: "58%",
    maxWidth: 900,
    aspectRatio: 1600 / 600,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
  },

  loginImagePlaceholderCompact: {
    width: "100%",
    maxWidth: 900,
  },

  loginArtwork: {
    width: "100%",
    height: "100%",
  },

  creatorCredit: {
    color: "#999",
    textAlign: "center",
    fontSize: 11,
    marginTop: 14,
    marginBottom: 4,
  },

  loginForm: {
    width: "36%",
    maxWidth: 440,
    alignSelf: "center",
  },

  loginFormCompact: {
    width: "100%",
  },

  roleSummary: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E6E2DB",
  },

  roleSummaryName: {
    flexShrink: 1,
    color: "#222",
    fontWeight: "700",
    fontSize: 15,
  },

  roleBadge: {
    color: "#FFFFFF",
    backgroundColor: "#315B50",
    overflow: "hidden",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: "800",
  },

  dashboardStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 6,
  },

  adminDashboardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },

  adminListingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E6E2DB",
    padding: 14,
    marginBottom: 9,
  },

  moderateButton: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#A62626",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },

  moderateButtonText: {
    color: "#A62626",
    fontWeight: "800",
  },

  removedListingLabel: {
    color: "#777",
    fontSize: 12,
    fontWeight: "700",
  },

  dashboardStat: {
    flexGrow: 1,
    flexBasis: 130,
    minWidth: 120,
    padding: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E6E2DB",
    borderRadius: 6,
  },

  dashboardStatValue: {
    color: "#7A1530",
    fontSize: 24,
    fontWeight: "800",
  },

  dashboardStatLabel: {
    color: "#555",
    fontSize: 12,
    marginTop: 4,
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

  disabledButton: {
    opacity: 0.6,
  },

  authError: {
    color: "#A62626",
    marginTop: 12,
    textAlign: "center",
    fontSize: 14,
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

  profileBar: {
    marginHorizontal: 24,
    marginTop: 4,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E6E2DB",
    flexDirection: "row",
    alignItems: "center",
  },

  profileAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },

  profileAvatarPlaceholder: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#173B6C",
    alignItems: "center",
    justifyContent: "center",
  },

  profileAvatarText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 13,
  },

  profileCopy: {
    flex: 1,
    marginLeft: 11,
  },

  profileGreeting: {
    color: "#222",
    fontWeight: "700",
    fontSize: 14,
  },

  profileHint: {
    color: "#777",
    fontSize: 12,
    marginTop: 2,
  },

  profilePhotoButton: {
    borderWidth: 1,
    borderColor: "#7A1530",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },

  profilePhotoButtonText: {
    color: "#7A1530",
    fontSize: 12,
    fontWeight: "700",
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

  legacyHeroVisual: {
    minHeight: 300,
    borderRadius: 22,
    padding: 22,
    overflow: "hidden",
    backgroundColor: "#173B6C",
    justifyContent: "flex-start",
    position: "relative",
  },

  legacyMobileHeroVisual: {
    minHeight: 180,
    height: 180,
    borderRadius: 16,
    padding: 16,
  },

  mobileSunsetGlow: {
    position: "absolute",
    top: -54,
    right: -26,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "#D86E70",
    opacity: 0.42,
  },

  mobileCastle: {
    position: "absolute",
    top: 54,
    right: "8%",
    width: 66,
    height: 92,
    alignItems: "center",
    opacity: 0.72,
  },

  mobileCastleRoof: {
    width: 0,
    height: 0,
    borderLeftWidth: 29,
    borderRightWidth: 29,
    borderBottomWidth: 32,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#E6EEF5",
  },

  mobileCastleBody: {
    width: 43,
    height: 60,
    backgroundColor: "#C8D9E8",
    alignItems: "center",
    paddingTop: 13,
  },

  mobileCastleWindow: {
    width: 12,
    height: 25,
    borderRadius: 7,
    backgroundColor: "#173B6C",
    borderWidth: 3,
    borderColor: "#8FAAC2",
  },

  mobileGlobe: {
    position: "absolute",
    left: "52%",
    bottom: 36,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    borderColor: "#E5EEF6",
    backgroundColor: "#527A9D",
    alignItems: "center",
    justifyContent: "center",
  },

  mobileGlobeLatitude: {
    width: 25,
    height: 11,
    borderWidth: 1,
    borderColor: "#DCEAF5",
    borderRadius: 12,
  },

  mobileGlobeLongitude: {
    position: "absolute",
    width: 11,
    height: 27,
    borderWidth: 1,
    borderColor: "#DCEAF5",
    borderRadius: 14,
  },

  mobileGlobePedestal: {
    position: "absolute",
    bottom: -12,
    width: 6,
    height: 13,
    backgroundColor: "#E5EEF6",
  },

  mobileBridge: {
    position: "absolute",
    left: "37%",
    bottom: 37,
    width: 54,
    height: 29,
  },

  mobileBridgeDeck: {
    position: "absolute",
    top: 8,
    left: 0,
    right: 0,
    height: 8,
    borderRadius: 3,
    backgroundColor: "#C8D9E8",
    borderBottomWidth: 3,
    borderBottomColor: "#7B95AD",
  },

  mobileBridgeArch: {
    position: "absolute",
    left: 14,
    bottom: 0,
    width: 27,
    height: 18,
    borderWidth: 4,
    borderBottomWidth: 0,
    borderColor: "#A8BED2",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },

  mobileBridgeRail: {
    position: "absolute",
    top: 3,
    left: 4,
    right: 4,
    height: 2,
    backgroundColor: "#173B6C",
  },

  mobileGround: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 54,
    backgroundColor: "#102D50",
    opacity: 0.95,
  },

  mobileEyebrow: {
    position: "absolute",
    top: 14,
    left: 16,
    color: "#DCE7F5",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.7,
  },

  mobileWelcome: {
    position: "absolute",
    top: 36,
    left: 16,
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
  },

  mobileTitle: {
    position: "absolute",
    top: 65,
    left: 16,
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },

  mobileBooth: {
    position: "absolute",
    left: 15,
    bottom: 17,
    width: 66,
    height: 54,
    zIndex: 5,
  },

  mobileBoothCanopy: {
    height: 18,
    borderRadius: 4,
    backgroundColor: "#B52B47",
    borderBottomWidth: 3,
    borderBottomColor: "#F1D9DD",
    alignItems: "center",
    justifyContent: "center",
  },

  mobileBoothLabel: { color: "#FFFFFF", fontSize: 7, fontWeight: "900", letterSpacing: 0.4 },

  mobileBoothCounter: {
    position: "absolute",
    bottom: 0,
    left: 3,
    right: 3,
    height: 25,
    borderRadius: 3,
    backgroundColor: "#DCE7F2",
    borderBottomWidth: 4,
    borderBottomColor: "#8CA8C0",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
  },

  mobileFigures: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 3,
    height: 135,
    zIndex: 10,
  },

  patriotmobileBooth: { left: "12%", bottom: -41, transform: [{ scale: 0.42 }] },
  patriotmobileDealLeft: { left: "46%", bottom: -31, transform: [{ scale: 0.47 }] },
  patriotmobileDealRight: { left: "61%", bottom: -22, transform: [{ scale: 0.36 }] },

  heroSkyGlow: {
    position: "absolute",
    top: -40,
    left: "22%",
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: "#E17A72",
    opacity: 0.28,
  },

  heroSunsetHorizon: {
    position: "absolute",
    bottom: 84,
    left: 0,
    right: 0,
    height: 90,
    backgroundColor: "#A94E5E",
    opacity: 0.42,
  },

  heroLightBeam: {
    position: "absolute",
    top: -70,
    left: "38%",
    width: 110,
    height: 350,
    backgroundColor: "#FFFFFF",
    transform: [{ rotate: "25deg" }],
    opacity: 0.06,
  },

  legacyHeroEyebrow: {
    position: "absolute",
    top: 18,
    left: 22,
    color: "#DCE7F5",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 8,
  },

  legacyHeroWelcome: {
    position: "absolute",
    top: 42,
    left: 22,
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 4,
  },

  legacyHeroTitle: {
    position: "absolute",
    top: 43,
    right: 22,
    width: "48%",
    fontSize: 30,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "right",
  },

  heroSubtitle: {
    fontSize: 16,
    color: "#777",
    marginTop: 8,
    marginBottom: 22,
  },

  heroVisualNote: {
    position: "absolute",
    top: 92,
    left: 22,
    color: "#DCE7F5",
    fontSize: 13,
    marginTop: 8,
    maxWidth: "76%",
  },

  campusArchitecture: {
    position: "absolute",
    top: 36,
    left: 0,
    right: 0,
    height: 160,
    opacity: 0.9,
  },

  campusMainHall: {
    position: "absolute",
    top: 38,
    left: "34%",
    width: 180,
    height: 95,
    backgroundColor: "#B9CDE1",
    alignItems: "center",
  },

  campusLowBuildingLeft: { position: "absolute", top: 82, left: "2%", width: 100, height: 48, backgroundColor: "#7897B3", alignItems: "center" },
  campusLowBuildingRight: { position: "absolute", top: 90, right: "1%", width: 92, height: 43, backgroundColor: "#7897B3", alignItems: "center" },
  lowBuildingRoof: { position: "absolute", top: -13, width: "115%", height: 17, borderRadius: 4, backgroundColor: "#C8D9E8", transform: [{ skewX: "-20deg" }] },
  lowBuildingWindow: { position: "absolute", top: 18, width: 24, height: 16, borderRadius: 4, backgroundColor: "#173B6C", borderWidth: 3, borderColor: "#AFC5D8" },
  campusLibrary: { position: "absolute", top: 101, left: "25%", width: 76, height: 39, backgroundColor: "#8AA5BB", alignItems: "center" },
  libraryRoof: { position: "absolute", top: -11, width: "120%", height: 14, backgroundColor: "#D3E0EB", borderRadius: 4 },
  libraryWindows: { position: "absolute", top: 15, width: 46, height: 11, backgroundColor: "#173B6C", borderWidth: 3, borderColor: "#B3C9DB" },

  mainHallRoof: {
    position: "absolute",
    top: -26,
    width: 235,
    height: 35,
    borderRadius: 4,
    backgroundColor: "#DCE7F2",
    transform: [{ skewX: "-24deg" }],
  },

  mainHallTower: {
    position: "absolute",
    top: -46,
    width: 68,
    height: 140,
    backgroundColor: "#DCE7F2",
    alignItems: "center",
    paddingTop: 37,
  },

  mainTowerRoof: {
    width: 0,
    height: 0,
    borderLeftWidth: 42,
    borderRightWidth: 42,
    borderBottomWidth: 52,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#F5F8FC",
    position: "absolute",
    top: -52,
  },

  mainTowerWindow: {
    width: 22,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#173B6C",
    borderWidth: 4,
    borderColor: "#A4BCD3",
  },

  mainTowerWindowLower: {
    width: 15,
    height: 23,
    borderRadius: 8,
    backgroundColor: "#173B6C",
    marginTop: 16,
  },

  mainHallWindowLeft: {
    position: "absolute",
    left: 15,
    top: 35,
    width: 32,
    height: 49,
    borderRadius: 13,
    backgroundColor: "#173B6C",
    borderWidth: 5,
    borderColor: "#8EAAC4",
  },

  mainHallWindowRight: {
    position: "absolute",
    right: 15,
    top: 35,
    width: 32,
    height: 49,
    borderRadius: 13,
    backgroundColor: "#173B6C",
    borderWidth: 5,
    borderColor: "#8EAAC4",
  },

  distanceTowerLeft: {
    position: "absolute",
    left: "12%",
    top: 70,
    width: 55,
    height: 85,
    backgroundColor: "#91ABC5",
    alignItems: "center",
  },

  distanceTowerRight: {
    position: "absolute",
    right: "10%",
    top: 79,
    width: 48,
    height: 72,
    backgroundColor: "#91ABC5",
    alignItems: "center",
  },

  distanceRoof: {
    width: 0,
    height: 0,
    borderLeftWidth: 31,
    borderRightWidth: 31,
    borderBottomWidth: 32,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#C8D9E8",
    position: "absolute",
    top: -32,
  },

  distanceTowerBody: {
    width: 13,
    height: 26,
    marginTop: 18,
    borderRadius: 7,
    backgroundColor: "#173B6C",
    borderWidth: 3,
    borderColor: "#C8D9E8",
  },

  campusBridge: {
    position: "absolute",
    left: "12%",
    bottom: 5,
    width: 116,
    height: 54,
  },

  bridgeDeck: { position: "absolute", top: 17, left: 0, right: 0, height: 15, borderRadius: 4, backgroundColor: "#C8D9E8", borderBottomWidth: 5, borderBottomColor: "#7B95AD" },

  bridgeArch: {
    position: "absolute",
    bottom: -4,
    left: "25%",
    width: "50%",
    height: 38,
    borderWidth: 8,
    borderBottomWidth: 0,
    borderColor: "#A8BED2",
    borderTopLeftRadius: 48,
    borderTopRightRadius: 48,
  },

  bridgeRail: {
    position: "absolute",
    top: 8,
    left: 4,
    right: 4,
    height: 3,
    backgroundColor: "#173B6C",
  },

  bridgePostLeft: { position: "absolute", top: 8, left: 17, width: 4, height: 22, backgroundColor: "#173B6C" },
  bridgePostRight: { position: "absolute", top: 8, right: 17, width: 4, height: 22, backgroundColor: "#173B6C" },

  campusGround: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 106,
    backgroundColor: "#102D50",
    opacity: 0.96,
  },

  campusWalkway: {
    position: "absolute",
    bottom: 0,
    left: "25%",
    width: "50%",
    height: 120,
    backgroundColor: "#2E4E6C",
    opacity: 0.65,
    transform: [{ skewX: "-24deg" }],
  },

  campusGlobe: {
    position: "absolute",
    left: "16%",
    bottom: 40,
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 6,
    borderColor: "#E5EEF6",
    backgroundColor: "#547A9D",
    alignItems: "center",
    justifyContent: "center",
  },

  globeLatitude: {
    width: 50,
    height: 22,
    borderWidth: 2,
    borderColor: "#DCEAF5",
    borderRadius: 17,
  },

  globeLongitude: {
    position: "absolute",
    width: 22,
    height: 54,
    borderWidth: 2,
    borderColor: "#DCEAF5",
    borderRadius: 17,
  },

  globeStand: {
    position: "absolute",
    bottom: -25,
    width: 10,
    height: 27,
    backgroundColor: "#E5EEF6",
  },

  homeLandmark: {
    position: "absolute",
    right: "22%",
    bottom: 40,
    width: 70,
    height: 53,
    borderRadius: 5,
    backgroundColor: "#E8D8C2",
    borderWidth: 3,
    borderColor: "#B9926B",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#071B32",
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },

  homeLandmarkText: {
    color: "#173B6C",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 1.4,
  },

  homeMonogram: {
    color: "#B52B47",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 1,
  },

  homeBase: {
    position: "absolute",
    bottom: -9,
    left: -8,
    right: -8,
    height: 10,
    borderRadius: 3,
    backgroundColor: "#8B6B50",
    borderTopWidth: 2,
    borderTopColor: "#D9B889",
  },

  campusTreeLeft: { position: "absolute", left: "3%", bottom: 76, alignItems: "center" },
  campusTreeRight: { position: "absolute", right: "4%", bottom: 80, alignItems: "center" },

  treeCrown: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#2D665D",
    borderWidth: 6,
    borderColor: "#3D7C68",
  },

  treeTrunk: { width: 9, height: 35, backgroundColor: "#7F654E" },

  marketBooth: {
    position: "absolute",
    bottom: 48,
    left: "6%",
    width: 142,
    height: 116,
    zIndex: 5,
  },

  boothCanopy: {
    height: 34,
    backgroundColor: "#B52B47",
    borderRadius: 7,
    borderBottomWidth: 6,
    borderBottomColor: "#F1D9DD",
    alignItems: "center",
    justifyContent: "center",
  },

  boothLabel: { color: "#FFFFFF", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  boothPostLeft: { position: "absolute", top: 32, left: 10, width: 8, height: 84, backgroundColor: "#DCE7F2" },
  boothPostRight: { position: "absolute", top: 32, right: 10, width: 8, height: 84, backgroundColor: "#DCE7F2" },

  boothCounter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 46,
    backgroundColor: "#DCE7F2",
    borderRadius: 5,
    borderBottomWidth: 7,
    borderBottomColor: "#8CA8C0",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
  },

  boothBook: { width: 23, height: 28, backgroundColor: "#B52B47", transform: [{ rotate: "-8deg" }] },
  boothDevice: { width: 24, height: 18, borderRadius: 3, backgroundColor: "#173B6C", borderWidth: 3, borderColor: "#83A1BC" },
  boothShirt: { width: 25, height: 22, borderRadius: 7, backgroundColor: "#FFFFFF" },

  marketFigures: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 9,
    height: 170,
    zIndex: 10,
  },

  patriotCharacter: { position: "absolute", width: 86, height: 190, alignItems: "center", transform: [{ scale: 0.72 }] },
  patriotbooth: { left: "7%", bottom: -21 },
  patriotbuying: { left: "23%", bottom: 4, transform: [{ scale: 0.58 }] },
  patriotdealLeft: { left: "45%", bottom: -17, transform: [{ scale: 0.72 }] },
  patriotdealRight: { left: "55%", bottom: -6, transform: [{ scale: 0.64 }] },
  patriotpackage: { right: "7%", bottom: 2, transform: [{ scale: 0.62 }] },

  patriotShadow: { position: "absolute", bottom: 0, width: 78, height: 15, borderRadius: 40, backgroundColor: "#071B32", opacity: 0.55 },
  patriotHat: { position: "absolute", top: 0, width: 68, height: 33, alignItems: "center", zIndex: 4 },
  patriotHatCrown: { width: 38, height: 27, backgroundColor: "#102D50", borderTopLeftRadius: 20, borderTopRightRadius: 20, transform: [{ skewX: "-8deg" }] },
  patriotHatBrim: { position: "absolute", bottom: 0, width: 76, height: 9, borderRadius: 7, backgroundColor: "#102D50" },
  patriotHatFeather: { position: "absolute", top: -7, right: 12, width: 8, height: 26, borderRadius: 8, backgroundColor: "#B52B47", transform: [{ rotate: "32deg" }] },
  patriotHead: { position: "absolute", top: 27, width: 45, height: 48, borderTopLeftRadius: 18, borderTopRightRadius: 14, borderBottomLeftRadius: 16, borderBottomRightRadius: 23, backgroundColor: "#E8B28F", borderWidth: 2, borderColor: "#7B4A43", zIndex: 3 },
  patriotHair: { position: "absolute", top: 0, left: 1, width: 29, height: 14, borderTopLeftRadius: 12, borderTopRightRadius: 8, backgroundColor: "#563E3B" },
  patriotBrow: { position: "absolute", top: 18, left: 8, width: 29, height: 5, borderTopWidth: 2, borderColor: "#7B4A43", transform: [{ rotate: "-4deg" }] },
  patriotEyeLeft: { position: "absolute", top: 21, left: 12, width: 4, height: 4, borderRadius: 2, backgroundColor: "#102D50" },
  patriotEyeRight: { position: "absolute", top: 21, right: 10, width: 4, height: 4, borderRadius: 2, backgroundColor: "#102D50" },
  patriotNose: { position: "absolute", top: 24, left: 20, width: 0, height: 0, borderTopWidth: 8, borderBottomWidth: 5, borderLeftWidth: 7, borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: "#B97866" },
  patriotChin: { position: "absolute", bottom: 1, right: 5, width: 13, height: 10, borderRadius: 7, backgroundColor: "#D5967D" },
  patriotSmile: { position: "absolute", bottom: 10, left: 19, width: 11, height: 6, borderBottomWidth: 2, borderColor: "#7B4A43", borderRadius: 8, zIndex: 2 },
  patriotTorso: { position: "absolute", top: 67, width: 59, height: 70, borderRadius: 16, backgroundColor: "#B52B47", borderWidth: 2, borderColor: "#F1D9DD", zIndex: 2 },
  patriotCollar: { position: "absolute", top: 0, left: 17, width: 24, height: 17, backgroundColor: "#FFFFFF", borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  patriotVest: { position: "absolute", top: 15, left: 17, width: 25, height: 46, backgroundColor: "#173B6C", borderRadius: 4 },
  patriotCoatButton: { position: "absolute", top: 27, left: 28, width: 5, height: 5, borderRadius: 3, backgroundColor: "#FFFFFF" },
  patriotCoatButtonLower: { position: "absolute", top: 42, left: 28, width: 5, height: 5, borderRadius: 3, backgroundColor: "#FFFFFF" },
  patriotArm: { position: "absolute", top: 78, width: 17, height: 58, borderRadius: 9, backgroundColor: "#B52B47", borderWidth: 2, borderColor: "#F1D9DD", zIndex: 1 },
  patriotArmLeft: { left: 5, transform: [{ rotate: "16deg" }] },
  patriotArmRight: { right: 5, transform: [{ rotate: "-16deg" }] },
  patriotArmExtended: { transform: [{ rotate: "68deg" }] },
  patriotArmExtendedRight: { transform: [{ rotate: "-68deg" }] },
  patriotPackage: { position: "absolute", top: 115, left: 4, width: 30, height: 25, backgroundColor: "#C89357", borderWidth: 2, borderColor: "#F2D09F", zIndex: 5, alignItems: "center", justifyContent: "center" },
  packageMark: { color: "#7A1530", fontSize: 9, fontWeight: "800" },
  patriotCash: { position: "absolute", top: 108, right: 1, width: 26, height: 15, borderRadius: 3, backgroundColor: "#A8D5A2", borderWidth: 2, borderColor: "#E6F4D9", zIndex: 5, alignItems: "center", justifyContent: "center" },
  cashMark: { color: "#2D665D", fontSize: 11, fontWeight: "800" },
  patriotLegLeft: { position: "absolute", top: 130, left: 20, width: 17, height: 46, borderRadius: 8, backgroundColor: "#173B6C" },
  patriotLegRight: { position: "absolute", top: 130, right: 20, width: 17, height: 46, borderRadius: 8, backgroundColor: "#173B6C" },
  patriotBootLeft: { position: "absolute", bottom: 7, left: 13, width: 28, height: 12, borderRadius: 7, backgroundColor: "#6B463A" },
  patriotBootRight: { position: "absolute", bottom: 7, right: 13, width: 28, height: 12, borderRadius: 7, backgroundColor: "#6B463A" },

  heroVisual: {
    height: 175,
    minHeight: 175,
    maxHeight: 175,
    overflow: "hidden",
    borderRadius: 18,
    backgroundColor: "#101F43",
    position: "relative",
  },

  mobileHeroVisual: {
    height: 155,
    minHeight: 155,
    maxHeight: 155,
    borderRadius: 14,
  },

  heroSky: { position: "absolute", left: 0, right: 0, top: 0, height: "100%", backgroundColor: "#14295A" },
  heroHorizon: { position: "absolute", left: 0, right: 0, bottom: 34, height: 58, backgroundColor: "#9A5262", opacity: 0.42 },
  heroGround: { position: "absolute", left: 0, right: 0, bottom: 0, height: 48, backgroundColor: "#102D50" },
  heroWalkway: { position: "absolute", left: "42%", bottom: -20, width: 104, height: 92, backgroundColor: "#38546A", opacity: 0.8, transform: [{ skewX: "-22deg" }] },

  heroTower: { position: "absolute", right: "34%", bottom: 43, width: 60, height: 108, alignItems: "center", opacity: 0.86 },
  heroTowerRoof: { width: 0, height: 0, borderLeftWidth: 31, borderRightWidth: 31, borderBottomWidth: 35, borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: "#DCE7F2" },
  heroTowerBody: { width: 42, height: 73, backgroundColor: "#B7CBDD", alignItems: "center", paddingTop: 15 },
  heroTowerWindow: { width: 13, height: 28, borderRadius: 7, backgroundColor: "#14295A", borderWidth: 3, borderColor: "#8BA6BE" },
  heroBuildingOne: { position: "absolute", left: "39%", bottom: 43, width: 92, height: 34, backgroundColor: "#718EA8", opacity: 0.7 },
  heroBuildingTwo: { position: "absolute", right: "7%", bottom: 47, width: 76, height: 28, backgroundColor: "#819BB0", opacity: 0.68 },
  heroBuildingRoof: { position: "absolute", top: -9, left: -5, right: -5, height: 12, backgroundColor: "#C8D9E8", transform: [{ skewX: "-18deg" }] },
  heroBuildingWindow: { position: "absolute", top: 12, left: "37%", width: 24, height: 9, backgroundColor: "#14295A", borderWidth: 2, borderColor: "#AFC5D8" },

  heroGlobe: { position: "absolute", left: "49%", bottom: 24, width: 46, height: 46, borderRadius: 23, backgroundColor: "#4C7899", borderWidth: 4, borderColor: "#E5EEF6", alignItems: "center", justifyContent: "center" },
  heroGlobeLatitude: { width: 34, height: 14, borderWidth: 2, borderColor: "#DCEAF5", borderRadius: 17 },
  heroGlobeLongitude: { position: "absolute", width: 15, height: 36, borderWidth: 2, borderColor: "#DCEAF5", borderRadius: 18 },
  heroGlobeStand: { position: "absolute", bottom: -17, width: 8, height: 18, backgroundColor: "#E5EEF6" },

  heroBridge: { position: "absolute", left: "35%", bottom: 28, width: 78, height: 30 },
  heroBridgeDeck: { position: "absolute", top: 7, left: 0, right: 0, height: 9, borderRadius: 3, backgroundColor: "#C8D9E8", borderBottomWidth: 3, borderBottomColor: "#728CA4" },
  heroBridgeArch: { position: "absolute", left: 21, bottom: 0, width: 36, height: 20, borderWidth: 5, borderBottomWidth: 0, borderColor: "#A8BED2", borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  heroBridgeRail: { position: "absolute", left: 5, right: 5, top: 2, height: 3, backgroundColor: "#173B6C" },

  heroHome: { position: "absolute", right: "7%", bottom: 28, width: 54, height: 30, borderRadius: 3, backgroundColor: "#DCC9AB", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#B89268" },
  heroHomeText: { color: "#173B6C", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  heroHomeMark: { color: "#B52B47", fontSize: 10, fontWeight: "900" },
  heroHomeBase: { position: "absolute", bottom: -6, left: -5, right: -5, height: 7, borderRadius: 2, backgroundColor: "#8B6B50" },

  heroEyebrow: { position: "absolute", top: 14, left: 16, color: "#DCE7F5", fontSize: 8, fontWeight: "800", letterSpacing: 0.7 },
  heroWelcome: { position: "absolute", top: 35, left: 16, color: "#FFFFFF", fontSize: 21, fontWeight: "800" },
  heroTitle: { position: "absolute", top: 38, right: 16, width: "38%", color: "#FFFFFF", fontSize: 19, fontWeight: "900", textAlign: "right" },
  heroNote: { position: "absolute", left: 16, top: 86, width: "34%", color: "#DCE7F5", fontSize: 9, lineHeight: 12 },
  heroMobileEyebrow: { position: "absolute", top: 11, left: 13, color: "#DCE7F5", fontSize: 7, fontWeight: "800", letterSpacing: 0.5 },
  heroMobileWelcome: { position: "absolute", top: 29, left: 13, color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  heroMobileTitle: { position: "absolute", top: 53, left: 13, color: "#FFFFFF", fontSize: 14, fontWeight: "800" },

  heroBooth: { position: "absolute", left: "4%", bottom: 12, width: 86, height: 62, zIndex: 5 },
  heroMobileBooth: { position: "absolute", left: 10, bottom: 8, width: 52, height: 38, zIndex: 5 },
  heroBoothCanopy: { height: 19, borderRadius: 4, backgroundColor: "#B52B47", borderBottomWidth: 3, borderBottomColor: "#F1D9DD", alignItems: "center", justifyContent: "center" },
  heroBoothLabel: { color: "#FFFFFF", fontSize: 6, fontWeight: "900", letterSpacing: 0.3 },
  heroBoothCounter: { position: "absolute", bottom: 0, left: 3, right: 3, height: 27, borderRadius: 3, backgroundColor: "#DCE7F2", borderBottomWidth: 4, borderBottomColor: "#8CA8C0", flexDirection: "row", alignItems: "center", justifyContent: "space-evenly" },
  heroProductBook: { width: 13, height: 18, backgroundColor: "#B52B47" },
  heroProductDevice: { width: 17, height: 11, borderRadius: 2, backgroundColor: "#173B6C", borderWidth: 2, borderColor: "#83A1BC" },
  heroProductPackage: { width: 14, height: 13, backgroundColor: "#C89357", borderWidth: 1, borderColor: "#F2D09F" },

  heroCharacters: { position: "absolute", left: 0, right: 0, bottom: 3, height: 142, zIndex: 10 },
  heroPatriot: { position: "absolute", width: 66, height: 148, alignItems: "center", transform: [{ scale: 0.72 }] },
  heroPatriotSeller: { left: "12%", bottom: -36, transform: [{ scale: 0.62 }] },
  heroPatriotHandshakeLeft: { left: "52%", bottom: -31, transform: [{ scale: 0.72 }] },
  heroPatriotHandshakeRight: { left: "63%", bottom: -19, transform: [{ scale: 0.56 }] },
  heroPatriotPackage: { right: "5%", bottom: -31, transform: [{ scale: 0.62 }] },
  heroPatriotMobileHandshakeLeft: { left: "48%", bottom: -28, transform: [{ scale: 0.42 }] },
  heroPatriotMobileHandshakeRight: { left: "64%", bottom: -19, transform: [{ scale: 0.34 }] },
  heroPatriotShadow: { position: "absolute", bottom: 0, width: 64, height: 11, borderRadius: 30, backgroundColor: "#071B32", opacity: 0.55 },
  heroPatriotHat: { position: "absolute", top: 0, width: 54, height: 27, alignItems: "center", zIndex: 4 },
  heroPatriotHatCrown: { width: 31, height: 22, backgroundColor: "#102D50", borderTopLeftRadius: 16, borderTopRightRadius: 16, transform: [{ skewX: "-8deg" }] },
  heroPatriotHatBrim: { position: "absolute", bottom: 0, width: 61, height: 8, borderRadius: 6, backgroundColor: "#102D50" },
  heroPatriotFeather: { position: "absolute", top: -6, right: 7, width: 7, height: 21, borderRadius: 7, backgroundColor: "#B52B47", transform: [{ rotate: "32deg" }] },
  heroPatriotHead: { position: "absolute", top: 23, width: 36, height: 40, borderTopLeftRadius: 15, borderTopRightRadius: 11, borderBottomLeftRadius: 13, borderBottomRightRadius: 20, backgroundColor: "#E8B28F", borderWidth: 2, borderColor: "#7B4A43", zIndex: 3 },
  heroPatriotHair: { position: "absolute", top: 0, left: 1, width: 24, height: 11, borderTopLeftRadius: 10, borderTopRightRadius: 7, backgroundColor: "#563E3B" },
  heroPatriotBrow: { position: "absolute", top: 15, left: 6, width: 24, height: 4, borderTopWidth: 2, borderColor: "#7B4A43" },
  heroPatriotEyeLeft: { position: "absolute", top: 18, left: 9, width: 3, height: 3, borderRadius: 2, backgroundColor: "#102D50" },
  heroPatriotEyeRight: { position: "absolute", top: 18, right: 8, width: 3, height: 3, borderRadius: 2, backgroundColor: "#102D50" },
  heroPatriotNose: { position: "absolute", top: 21, left: 16, width: 0, height: 0, borderTopWidth: 7, borderBottomWidth: 4, borderLeftWidth: 6, borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: "#B97866" },
  heroPatriotChin: { position: "absolute", bottom: 1, right: 4, width: 11, height: 8, borderRadius: 6, backgroundColor: "#D5967D" },
  heroPatriotSmile: { position: "absolute", bottom: 8, left: 15, width: 9, height: 5, borderBottomWidth: 2, borderColor: "#7B4A43", borderRadius: 7 },
  heroPatriotTorso: { position: "absolute", top: 56, width: 46, height: 57, borderRadius: 13, backgroundColor: "#B52B47", borderWidth: 2, borderColor: "#F1D9DD", zIndex: 2 },
  heroPatriotCollar: { position: "absolute", top: 0, left: 13, width: 20, height: 13, backgroundColor: "#FFFFFF", borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  heroPatriotVest: { position: "absolute", top: 13, left: 13, width: 20, height: 38, backgroundColor: "#173B6C", borderRadius: 3 },
  heroPatriotButton: { position: "absolute", top: 23, left: 22, width: 4, height: 4, borderRadius: 2, backgroundColor: "#FFFFFF" },
  heroPatriotButtonLower: { position: "absolute", top: 35, left: 22, width: 4, height: 4, borderRadius: 2, backgroundColor: "#FFFFFF" },
  heroPatriotArm: { position: "absolute", top: 65, width: 13, height: 47, borderRadius: 8, backgroundColor: "#B52B47", borderWidth: 2, borderColor: "#F1D9DD", zIndex: 1 },
  heroPatriotArmLeft: { left: 4, transform: [{ rotate: "16deg" }] },
  heroPatriotArmRight: { right: 4, transform: [{ rotate: "-16deg" }] },
  heroPatriotArmExtended: { transform: [{ rotate: "68deg" }] },
  heroPatriotArmExtendedRight: { transform: [{ rotate: "-68deg" }] },
  heroPatriotPackageItem: { position: "absolute", top: 95, left: 2, width: 24, height: 20, backgroundColor: "#C89357", borderWidth: 2, borderColor: "#F2D09F", zIndex: 5, alignItems: "center", justifyContent: "center" },
  heroPackageMark: { color: "#7A1530", fontSize: 7, fontWeight: "800" },
  heroPatriotLegLeft: { position: "absolute", top: 107, left: 15, width: 13, height: 36, borderRadius: 7, backgroundColor: "#173B6C" },
  heroPatriotLegRight: { position: "absolute", top: 107, right: 15, width: 13, height: 36, borderRadius: 7, backgroundColor: "#173B6C" },
  heroPatriotBootLeft: { position: "absolute", bottom: 6, left: 9, width: 22, height: 10, borderRadius: 6, backgroundColor: "#6B463A" },
  heroPatriotBootRight: { position: "absolute", bottom: 6, right: 9, width: 22, height: 10, borderRadius: 6, backgroundColor: "#6B463A" },

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

  filterRow: {
    paddingHorizontal: 24,
    gap: 8,
    paddingBottom: 14,
  },

  filterOption: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#DDD",
    backgroundColor: "#FFFFFF",
  },

  filterOptionActive: {
    backgroundColor: "#7A1530",
    borderColor: "#7A1530",
  },

  filterOptionText: {
    color: "#555",
    fontSize: 12,
    fontWeight: "600",
  },

  filterOptionTextActive: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
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

  cardImage: {
    width: 58,
    height: 58,
    borderRadius: 12,
  },

  cardAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginLeft: 8,
  },

  cardAvatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginLeft: 8,
    backgroundColor: "#DCE7F5",
    alignItems: "center",
    justifyContent: "center",
  },

  cardAvatarText: {
    color: "#173B6C",
    fontSize: 9,
    fontWeight: "800",
  },

  placeholderIcon: {
    fontSize: 25,
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

  favorite: {
    color: "#7A1530",
    fontSize: 24,
    marginLeft: 8,
  },

  status: {
    alignSelf: "flex-start",
    color: "#2F6B45",
    backgroundColor: "#E4F1E8",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginTop: 10,
    fontWeight: "700",
  },

  soldStatus: {
    color: "#A62626",
    backgroundColor: "#F7DCDC",
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

  detailContainer: {
    flex: 1,
    backgroundColor: "#F8F5EF",
  },

  detailContent: {
    padding: 24,
    paddingBottom: 40,
  },

  closeButton: {
    alignSelf: "flex-end",
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 12,
  },

  closeButtonText: {
    color: "#7A1530",
    fontSize: 16,
    fontWeight: "700",
  },

  detailImage: {
    width: "100%",
    height: 260,
    borderRadius: 18,
    backgroundColor: "#F1EEE7",
    marginBottom: 22,
  },

  detailMainImage: {
    width: "100%",
    height: 260,
    borderRadius: 18,
    backgroundColor: "#F1EEE7",
    resizeMode: "cover",
  },

  detailThumbnailRow: {
    gap: 8,
    paddingVertical: 10,
  },

  detailThumbnail: {
    width: 68,
    height: 58,
    borderRadius: 8,
    backgroundColor: "#F1EEE7",
    borderWidth: 2,
    borderColor: "transparent",
  },

  detailThumbnailActive: {
    borderColor: "#7A1530",
  },

  detailImagePlaceholder: {
    width: "100%",
    height: 260,
    borderRadius: 18,
    backgroundColor: "#F1EEE7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },

  placeholderText: {
    color: "#777",
    fontSize: 15,
  },

  detailTitle: {
    fontSize: 30,
    fontWeight: "800",
    color: "#222",
  },

  detailCategory: {
    color: "#777",
    fontSize: 16,
    marginTop: 6,
  },

  detailPrice: {
    color: "#7A1530",
    fontSize: 26,
    fontWeight: "800",
    marginTop: 18,
  },

  detailSeller: {
    color: "#555",
    fontSize: 15,
    marginTop: 8,
  },

  sellerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 18,
  },

  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
  },

  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
    backgroundColor: "#E5DED2",
    alignItems: "center",
    justifyContent: "center",
  },

  detailEmail: {
    color: "#777",
    fontSize: 13,
    marginTop: 3,
  },

  detailDescription: {
    color: "#333",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 24,
  },

  buyButton: {
    height: 58,
    borderRadius: 14,
    backgroundColor: "#7A1530",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 30,
  },

  buyButtonText: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "800",
  },

  chatButton: {
    height: 52,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#7A1530",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },

  chatButtonText: {
    color: "#7A1530",
    fontSize: 17,
    fontWeight: "800",
  },

  favoriteDetail: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#7A1530",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },

  statusControls: {
    marginTop: 24,
    padding: 16,
    backgroundColor: "#FFF",
    borderRadius: 14,
  },

  deleteListingButton: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#A62626",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },

  deleteListingButtonText: {
    color: "#A62626",
    fontSize: 15,
    fontWeight: "800",
  },

  deleteConfirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(7, 27, 50, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },

  deleteConfirmCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    padding: 22,
    backgroundColor: "#FFFFFF",
    shadowColor: "#071B32",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },

  deleteConfirmTitle: {
    color: "#222",
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 10,
  },

  deleteConfirmMessage: {
    color: "#555",
    fontSize: 15,
    lineHeight: 22,
  },

  deleteConfirmActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },

  deleteCancelButton: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D5D0C8",
    alignItems: "center",
    justifyContent: "center",
  },

  deleteCancelText: {
    color: "#555",
    fontWeight: "700",
  },

  deleteConfirmButton: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    backgroundColor: "#A62626",
    alignItems: "center",
    justifyContent: "center",
  },

  deleteConfirmText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },

  myMarketContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 48,
    width: "100%",
    maxWidth: 920,
    alignSelf: "center",
  },

  myMarketError: {
    color: "#A62626",
    backgroundColor: "#FBECEC",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },

  myMarketSection: {
    color: "#222",
    fontSize: 20,
    fontWeight: "800",
    marginTop: 14,
    marginBottom: 10,
  },

  myMarketRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E6E2DB",
    padding: 14,
    marginBottom: 9,
  },

  myMarketThumbnail: {
    width: 64,
    height: 64,
    borderRadius: 9,
    backgroundColor: "#F1EEE7",
    marginRight: 12,
  },

  myMarketThumbnailPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 9,
    backgroundColor: "#F1EEE7",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  myMarketRowContent: {
    flex: 1,
    minWidth: 0,
  },

  myMarketActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 8,
  },

  myMarketAction: {
    color: "#7A1530",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 5,
  },

  myMarketDeleteAction: {
    color: "#A62626",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 5,
  },

  messagePreview: {
    color: "#777",
    fontSize: 12,
    marginTop: 6,
  },

  purchaseActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },

  detailPurchaseActions: {
    gap: 8,
    marginTop: 10,
  },

  detailPurchaseButton: {
    flex: 0,
    width: "100%",
  },

  purchaseAcceptButton: {
    flex: 1,
    borderRadius: 9,
    paddingVertical: 9,
    alignItems: "center",
    backgroundColor: "#2F6B45",
  },

  purchaseAcceptText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },

  purchaseCashButton: {
    flex: 1,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#7A1530",
    paddingVertical: 9,
    alignItems: "center",
  },

  purchaseCashText: {
    color: "#7A1530",
    fontWeight: "800",
  },

  purchaseDeclineButton: {
    flex: 1,
    borderRadius: 9,
    paddingVertical: 9,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#A62626",
  },

  purchaseDeclineText: {
    color: "#A62626",
    fontWeight: "800",
  },

  editListingButton: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#7A1530",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },

  editListingButtonText: {
    color: "#7A1530",
    fontSize: 16,
    fontWeight: "800",
  },

  editContent: {
    padding: 24,
    paddingBottom: 48,
  },

  editHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },

  editDescriptionInput: {
    minHeight: 100,
    height: 100,
    paddingTop: 14,
    textAlignVertical: "top",
  },

  editFieldLabel: {
    color: "#333",
    fontSize: 14,
    fontWeight: "800",
    marginTop: 8,
    marginBottom: 8,
  },

  editOptionRow: {
    gap: 8,
    paddingBottom: 8,
  },

  editOption: {
    borderWidth: 1,
    borderColor: "#D5D0C8",
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },

  editOptionActive: {
    borderColor: "#7A1530",
    backgroundColor: "#7A1530",
  },

  editOptionText: {
    color: "#555",
    fontSize: 13,
  },

  editOptionTextActive: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },

  editImageHint: {
    color: "#777",
    fontSize: 13,
    marginBottom: 4,
  },

  statusLabel: {
    fontWeight: "700",
    marginBottom: 10,
  },

  statusOption: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#DDD",
  },

  statusOptionActive: {
    backgroundColor: "#7A1530",
    borderColor: "#7A1530",
  },

  statusOptionText: {
    color: "#555",
  },

  statusOptionTextActive: {
    color: "#FFF",
    fontWeight: "700",
  },

  conversationRow: {
    backgroundColor: "#FFF",
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },

  imagePicker: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#7A1530",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },

  contactHint: {
    color: "#777",
    textAlign: "center",
    fontSize: 12,
    marginTop: 10,
  },

  chatHeader: {
    padding: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  messages: {
    padding: 24,
    gap: 10,
    flexGrow: 1,
  },

  message: {
    alignSelf: "flex-start",
    backgroundColor: "#FFF",
    borderRadius: 14,
    padding: 12,
    maxWidth: "80%",
  },

  myMessage: {
    alignSelf: "flex-end",
    backgroundColor: "#EAD5DC",
  },

  messageComposer: {
    flexDirection: "row",
    padding: 16,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#E1DDD5",
  },

  messageInput: {
    flex: 1,
    minHeight: 48,
    backgroundColor: "#FFF",
    borderRadius: 12,
    paddingHorizontal: 14,
  },

  sendButton: {
    backgroundColor: "#7A1530",
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: "center",
  },

  sendText: {
    color: "#FFF",
    fontWeight: "700",
  },

  footer: {
    textAlign: "center",
    color: "#999",
    marginTop: 30,
    marginBottom: 30,
    fontSize: 12,
  },

  formTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#222",
  },
});