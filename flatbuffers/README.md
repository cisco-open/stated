Integration with flatbuffers is an experimental WIP. General approach:
1) allow fields of Stated template to be declared as backed by a flatbuffer
2) use JS proxy to intercept (transparently) JSONata access to flatbuffered object and convert to flatbuffer native access call
