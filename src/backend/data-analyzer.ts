import { Tweet, User } from './twitter-api-timeline-response';
import { UserDataResponse, Graph, MultiLineGraph, TermOccurrenceList as TermOccurrenceList } from '@/api-common';
import APIError from './api-error';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import fleschKincaid from 'flesch-kincaid';
import syllables from 'syllable';

function flattenOneLevel<T>(arrays: T[][]): T[] {
  return ([] as T[]).concat(...arrays);
}

const MOST_COMMON_WORDS = flattenOneLevel(readdirSync(join(__dirname, 'most-common-words')).map((filename) => {
  const fullFilename = join(__dirname, 'most-common-words', filename);
  return readFileSync(fullFilename).toString().split(/\r?\n/);
}));

/**
 * Counts the values of an array and returns them in a map with the
 * value as the key and the number of instances of that value as the value.
 * This method excludes undefined values.
 * @param array the array to count the instances of
 * @returns the map containing the number of instances of each array value.
 */
function countArrayValues<T>(array: T[]): Map<T, number> {
  const valueCount = new Map<T, number>();
  array.filter((x) => x !== undefined).forEach((x) => {
    valueCount.set(x, (valueCount.get(x) || 0) + 1);
  });
  return valueCount;
}

/**
 * Creates a graph where month is the x axis and number of tweets
 * that month is the y axis.
 * @param tweets
 */
function createTweetsPerMonthGraph(tweets: Tweet[]): Graph {
  const roundDownToNearestMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
  const monthsOfTweets = tweets.map((tweet) => roundDownToNearestMonth(new Date(tweet.created_at)).getTime());
  const mapEntryToGraphPoint = ([monthDatetime, tweetsThatMonth]: [number, number]) => ({
    date: monthDatetime, value: tweetsThatMonth,
  });
  return Array.from(countArrayValues(monthsOfTweets).entries()).map(mapEntryToGraphPoint);
}

/**
 * Creates a generic graph with a data point for each tweet.
 * @param tweets
 * @param getValue the function that returns the y value on the graph for each tweet
 */
function createTweetGraph(tweets: Tweet[], getValue: (tweet: Tweet) => number): Graph {
  return tweets.map((tweet) => ({
    date: new Date(tweet.created_at).getTime(),
    value: getValue(tweet),
  }));
}

/**
 * Creates a multiline graph where each line is a term. Uses the 5 most used terms.
 * @param tweets
 * @param getTerms
 * @param amount the number of lines to graph
 */
function createMultiLineTermGraph(
  tweets: Tweet[],
  getTerms: (tweet: Tweet) => string[],
  amount: number): MultiLineGraph {
  const topTerms = getTopTerms(tweets, getTerms, amount).map((entity) => entity.term);
  const getTweetsWithTerm = (term: string) => tweets.filter((tweet) => getTerms(tweet).some((t) => term === t));
  function getTermUseGraph(term: string): Graph {
    const graph: Graph = [];
    getTweetsWithTerm(term).reverse().forEach((tweet, i) => {
      graph.push({
        date: new Date(tweet.created_at).getTime(),
        value: (graph[i - 1] ? graph[i - 1].value : 0) + 1,
      });
    });
    return graph;
  }
  return topTerms.map((term) => ({
    term,
    points: getTermUseGraph(term),
  }));
}

/**
 * Returns the top few terms for given tweets, based on the getTerms function provided.
 * @param tweets
 * @param getTerms The function that returns a list of terms for a given tweet.
 * @param amount The maximum number of terms to return.
 */
function getTopTerms(tweets: Tweet[], getTerms: (tweet: Tweet) => string[], amount: number): TermOccurrenceList {
  const termCounts = countArrayValues(flattenOneLevel(tweets.map(getTerms)));
  const sortEntries = (a: [string, number], b: [string, number]) => b[1] - a[1];
  return Array.from(termCounts.entries()).sort(sortEntries).slice(0, amount).map(([term, occurrences]) => ({
    term, occurrences,
  }));
}

// const getEntitiesIfOriginal = (getEntities: (tweet: Tweet) => string[]) => (tweet: Tweet) => {
//   const log = <T>(x: T) => (console.log(x), x);
//   return tweet.retweeted_status ? [] : log(getEntities(tweet));
// };
const getMentionedPeople = (tweet: Tweet) => tweet.entities.user_mentions.map((mention) => '@' + mention.screen_name);
const getOriginalPosterHandleAsArray = (tweet: Tweet) => {
  return tweet.retweeted_status ? ['@' + tweet.retweeted_status.user.screen_name] : [];
};
const getHashtags = (tweet: Tweet) => tweet.entities.hashtags.map((hashtag) => '#' + hashtag.text);
const getOriginal = (tweet: Tweet) => tweet.retweeted_status ? tweet.retweeted_status : tweet;

function removeURLs(text: string) {
  const url = /[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)?/gi;
  return text.replace(url, '');
}

function getRealWords(text: string): string[] {
  let matches = removeURLs(text).match(/([#@]?[A-Za-z]+)/g);
  if (matches === null) {
    matches = [];
  }
  const removeHashtags = (word: string) => !word.startsWith('#');
  const removeMentions = (word: string) => !word.startsWith('@');
  return matches.filter(removeHashtags).filter(removeMentions);
}

function getSignificantWords(tweet: Tweet) {
  const removeCommonWords = (word: string) => !MOST_COMMON_WORDS.includes(word.toLowerCase());
  return getRealWords(tweet.text).filter(removeCommonWords);
}

const average = (array: number[]) => array.reduce((a, b) => a + b) / array.length;

function gradeLevel(text: string) {
  return fleschKincaid({
    word: getRealWords(text).length,
    sentence: removeURLs(text).split('.').length,
    syllable: syllables(text),
  });
}

export default function analyzeData(tweets: Tweet[]): UserDataResponse {
  // Tweets are in reverse chronological order
  if (tweets.length === 0) {
    throw new APIError('This user hasn\'t posted any tweets, so we can\'t analyze them.');
  }
  const user: User = tweets[0].user;
  return {
    basicProfileInfo: {
      followers: user.followers_count,
      following: user.friends_count,
      profilePictureURL: user.profile_image_url,
      verified: user.verified,
      description: user.description,
      name: user.name,
      handle: user.screen_name,
      location: user.location,
      url: user.url,
      yearJoined: new Date(user.created_at).getFullYear(),
    },
    tweetsPerMonth: createTweetsPerMonthGraph(tweets),
    latestTweetData: [
      {
        term: 'Likes',
        points: createTweetGraph(tweets, (t) => getOriginal(t).favorite_count),
      },
      {
        term: 'Retweets',
        points: createTweetGraph(tweets, (t) => t.retweet_count),
      },
    ],
    mostMentionedPeople: createMultiLineTermGraph(tweets, getMentionedPeople, 5),
    mostRetweetedPeople: createMultiLineTermGraph(tweets, getOriginalPosterHandleAsArray, 5),
    mostUsedHashtags: createMultiLineTermGraph(tweets, getHashtags, 5),
    mostUsedWords: createMultiLineTermGraph(tweets, getSignificantWords, 5),
    averageTweetLength: Math.round(average(tweets.map((t) => getOriginal(t).text.length))),
    readingGradeLevel: average(tweets.map((t) => gradeLevel(getOriginal(t).text))),
  };
}
