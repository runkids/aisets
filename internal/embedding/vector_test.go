package embedding

import (
	"math"
	"testing"
)

func TestSerializeDeserializeRoundtrip(t *testing.T) {
	original := []float32{1.0, -2.5, 3.14159, 0, math.MaxFloat32, math.SmallestNonzeroFloat32}
	buf := SerializeVector(original)
	if len(buf) != len(original)*4 {
		t.Fatalf("expected %d bytes, got %d", len(original)*4, len(buf))
	}
	restored := DeserializeVector(buf)
	if len(restored) != len(original) {
		t.Fatalf("expected %d floats, got %d", len(original), len(restored))
	}
	for i := range original {
		if restored[i] != original[i] {
			t.Errorf("index %d: expected %v, got %v", i, original[i], restored[i])
		}
	}
}

func TestDeserializeEmpty(t *testing.T) {
	v := DeserializeVector(nil)
	if len(v) != 0 {
		t.Fatalf("expected empty, got %d", len(v))
	}
}

func TestCosineSimilarityIdentical(t *testing.T) {
	v := []float32{1, 2, 3, 4}
	sim := CosineSimilarity(v, v)
	if math.Abs(float64(sim)-1.0) > 1e-6 {
		t.Errorf("identical vectors: expected ~1.0, got %f", sim)
	}
}

func TestCosineSimilarityOrthogonal(t *testing.T) {
	a := []float32{1, 0, 0}
	b := []float32{0, 1, 0}
	sim := CosineSimilarity(a, b)
	if math.Abs(float64(sim)) > 1e-6 {
		t.Errorf("orthogonal vectors: expected ~0, got %f", sim)
	}
}

func TestCosineSimilarityOpposite(t *testing.T) {
	a := []float32{1, 2, 3}
	b := []float32{-1, -2, -3}
	sim := CosineSimilarity(a, b)
	if math.Abs(float64(sim)+1.0) > 1e-6 {
		t.Errorf("opposite vectors: expected ~-1.0, got %f", sim)
	}
}

func TestCosineSimilarityZeroVector(t *testing.T) {
	a := []float32{0, 0, 0}
	b := []float32{1, 2, 3}
	sim := CosineSimilarity(a, b)
	if sim != 0 {
		t.Errorf("zero vector: expected 0, got %f", sim)
	}
}

func TestCosineSimilarityLengthMismatch(t *testing.T) {
	a := []float32{1, 2}
	b := []float32{1, 2, 3}
	sim := CosineSimilarity(a, b)
	if sim != 0 {
		t.Errorf("length mismatch: expected 0, got %f", sim)
	}
}

func TestCosineSimilarityEmpty(t *testing.T) {
	sim := CosineSimilarity(nil, nil)
	if sim != 0 {
		t.Errorf("empty: expected 0, got %f", sim)
	}
}
