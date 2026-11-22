import React from 'react'
import { View, Text, TouchableOpacity, FlatList, Image, Dimensions, StyleSheet } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialIcons'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

/** Walkthrough screens describing key app features. */
const WALKTHROUGH_DATA = [
  {
    id: 1,
    title: 'Welcome to StockEvo',
    image: require('../assets/walkthrough/1.png'),
    description:
      'Manage your inventory, track stock levels, and never run out of essential items again.',
  },
  {
    id: 2,
    title: 'Add Products',
    image: require('../assets/walkthrough/2.png'),
    description:
      'Scan or add products with categories, barcodes, and supplier prices. Set pack sizes and reorder points.',
  },
  {
    id: 3,
    title: 'Track Sales',
    image: require('../assets/walkthrough/3.png'),
    description:
      'Record every sale instantly. The app automatically deducts stock and updates health alerts.',
  },
  {
    id: 4,
    title: 'Restock Alerts',
    image: require('../assets/walkthrough/4.png'),
    description:
      'Get notified when stock is low or critical. View recommendations with cheapest supplier prices.',
  },
  {
    id: 5,
    title: 'Stock Summary',
    image: require('../assets/walkthrough/5.png'),
    description:
      'Weekly stock summaries and theft detection alerts keep your inventory secure.',
  },
]

export const WalkthroughScreen: React.FC = () => {
  const [currentIndex, setCurrentIndex] = React.useState(0)
  const [hasCompleted, setHasCompleted] = React.useState(false)

  const handleSkip = () => setHasCompleted(true)
  const handleDone = () => {
    setHasCompleted(true)
    // TODO: persist user preference so this doesn't show again
  }

  const renderItem = ({
    item: { id, title, image, description },
    index,
    navigators,
  }: {
    item: typeof WALKTHROUGH_DATA[0]
    index: number
    navigators: any
  }) => {
    const scale = Math.max(0.8, 1 - index * 0.15)

    return (
      <View
        style={styles.container}
        accessible={false}
      >
        <Image
          source={image}
          style={styles.image}
          resizeMode="contain"
        />
        <View style={styles.content}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.main}>
      <FlatList
        data={WALKTHROUGH_DATA}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        renderItem={renderItem}
        keyExtractor={(item) => item.id.toString()}
        onScrollEndDrag={({ absoluteIndex: index }) => {
          setCurrentIndex(index)
        }}
      />

      {/* Page indicator */}
      <View style={styles.indicatorContainer}>
        {WALKTHROUGH_DATA.map((_, i) => (
          <View
            key={i}
            style={[
              styles.indicatorDot,
              { backgroundColor: i === currentIndex ? 'primary' : 'secondary' },
            ]}
          />
        ))}
      </View>

      {/* Navigation buttons */}
      <View style={styles.buttonRow}>
        <TouchableOpacity onPress={handleSkip} style={styles.button}>
          <Icon name="skip-next" size={20} color="white" />
          <Text style={styles.buttonText}>Skip</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleDone}
          style={styles.button}
          disabled={currentIndex < WALKTHROUGH_DATA.length - 1}
        >
          {currentIndex < WALKTHROUGH_DATA.length - 1 ? (
            <Icon name="navigate-next" size={20} color="white" />
          ) : (
            <Text style={styles.buttonText}>Get Started</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  main: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  container: {
    width: SCREEN_WIDTH,
    paddingHorizontal: 40,
    paddingVertical: 80,
    alignItems: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: 200,
    marginBottom: 24,
  },
  content: {
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: '#ccc',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  indicatorContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 32,
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
    transition: { opacity: 200 },
    backgroundColor: '#555',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '80%',
    alignItems: 'center',
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'primary',
    borderRadius: 25,
    elevation: 2,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    marginHorizontal: 8,
  },
})