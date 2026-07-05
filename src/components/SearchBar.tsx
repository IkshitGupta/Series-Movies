import { Ionicons } from '@expo/vector-icons';
import { Pressable, TextInput, View } from 'react-native';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search movies & shows',
}: SearchBarProps) {
  return (
    <View className="flex-row items-center gap-2 rounded-2xl bg-neutral-100 px-3 dark:bg-neutral-800">
      <Ionicons name="search" size={18} color="#9ca3af" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        className="flex-1 py-3 text-base text-neutral-900 dark:text-neutral-50"
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8}>
          <Ionicons name="close-circle" size={18} color="#9ca3af" />
        </Pressable>
      ) : null}
    </View>
  );
}
