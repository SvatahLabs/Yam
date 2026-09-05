package com.svatah.automator.core;

import com.svatah.automator.exceptions.NotUniqueKeyException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Created by AtulSharma on 05/07/18
 */
public class ActionDictionary<K, V> {

    private Map<K, List<V>> map;
    private Map<K, Class<K>> classMap;
    private Map<V, K> inverseMap;

    public ActionDictionary() {
        this.map = new HashMap<>();
        this.classMap = new HashMap<>();
        this.inverseMap = new HashMap<>();
    }

    public void put(K key, V value) {
        if (inverseMap.containsKey(value))
            throw new NotUniqueKeyException("value :" + value + " defined for key : " + key + " already is mapped with key : " + inverseMap.get(value));
        inverseMap.put(value, key);
        if (map.containsKey(key)) {
            map.get(key).add(value);
        } else {
            List<V> list = new ArrayList<>();
            list.add(value);
            map.put(key, list);
            classMap.put(key, (Class<K>)key.getClass());
        }
    }

    public Map<V, K> getInverseMap() {
        return inverseMap;
    }

    public Map<K, List<V>> getMap() {
        return map;
    }

    public Map<K, Class<K>> getClassMap() {
        return classMap;
    }
}
